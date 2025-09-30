import {AppContext} from "#/setup";
import {bskyPublicAPI, NoSessionAgent, SessionAgent} from "#/utils/session-agent";
import {PostView as BskyPostView} from "#/lex-server/types/app/bsky/feed/defs";
import {ProfileViewBasic, ProfileViewDetailed} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {
    BlobRef, ThreadSkeleton
} from "#/services/hydration/hydrate";
import {FeedSkeleton} from "#/services/feed/feed";
import {getObjectKey, removeNullValues, unique} from "#/utils/arrays";
import {
    getCollectionFromUri,
    getDidFromUri,
    isArticle,
    isDataset,
    isPost,
    postUris,
    topicVersionUris
} from "#/utils/uri";
import {$Typed, AtpBaseClient} from "@atproto/api";
import {TopicVersionQueryResultBasic} from "#/services/wiki/topics";
import {isMain as isVisualizationEmbed} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {
    FeedViewPost,
    isPostView, isReasonRepost,
    isSkeletonReasonRepost, isThreadViewPost,
    PostView, ThreadViewPost
} from "@atproto/api/dist/client/types/app/bsky/feed/defs";
import {fetchTextBlobs} from "#/services/blob";
import {env} from "#/lib/env";
import {RepostQueryResult} from "#/services/feed/inicio/following";
import {isView as isEmbedRecordView} from "#/lex-api/types/app/bsky/embed/record"
import {isView as isEmbedRecordWithMediaView} from "#/lex-api/types/app/bsky/embed/recordWithMedia"
import {isViewNotFound, isViewRecord} from "#/lex-api/types/app/bsky/embed/record";
import {NotificationQueryResult, NotificationsSkeleton} from "#/services/notifications/notifications";
import {equalFilterCond, inFilterCond, stringListIncludes} from "#/services/dataset/read";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {jsonArrayFrom} from 'kysely/helpers/postgres'
import {
    ColumnFilter,
    isColumnFilter
} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {getUrisFromThreadSkeleton} from "#/services/thread/thread";
import {prettyPrintJSON} from "#/utils/strings";
import {getValidationState} from "../user/users";
import {AppBskyActorDefs} from "@atproto/api"
import {AppBskyFeedPost, ArCabildoabiertoActorDefs} from "#/lex-api/index"
import { CAProfile } from "#/lib/types";
import {hydrateProfileView} from "#/services/hydration/profile";


export type FeedElementQueryResult = {
    uri: string
    cid: string
    created_at: Date,
    record: string | null
    repliesCount: number
    quotesCount: number
    uniqueLikesCount: number
    uniqueRepostsCount: number
    text: string | null
    textBlobId: string | null
    format: string | null
    dbFormat: string | null
    selfLabels: string[]
    title: string | null
    props: unknown
    topicId: string | null
    embeds: unknown
    datasetsUsed: { uri: string }[]
}


export type DatasetQueryResult = {
    uri: string
    cid: string
    created_at: Date
    title: string
    description: string | null
    columns: string[]
    dataBlocks: {
        cid: string
        format: string | null
    }[]
}


export type TopicMentionedProps = {
    count: number
    id: string
    props: unknown
}


export function joinMaps<T>(a?: Map<string, T>, b?: Map<string, T>): Map<string, T> {
    return new Map([...a ?? [], ...b ?? []])
}


export function getBlobKey(blob: BlobRef) {
    return blob.cid + ":" + blob.authorId
}


export function blobRefsFromContents(contents: {
    content?: { textBlobId?: string | null } | null,
    uri: string
}[]) {
    const blobRefs: { cid: string, authorId: string }[] = contents
        .map(a => (a.content?.textBlobId != null ? {cid: a.content.textBlobId, authorId: getDidFromUri(a.uri)} : null))
        .filter(x => x != null)

    return blobRefs
}


export class Dataplane {
    ctx: AppContext
    agent: SessionAgent | NoSessionAgent
    caContents: Map<string, FeedElementQueryResult> = new Map()
    bskyPosts: Map<string, BskyPostView> = new Map()
    likes: Map<string, string | null> = new Map()
    reposts: Map<string, RepostQueryResult | null> = new Map() // mapea uri del post a información del repost asociado
    topicsByUri: Map<string, TopicVersionQueryResultBasic> = new Map()
    textBlobs: Map<string, string> = new Map()
    datasets: Map<string, DatasetQueryResult> = new Map()
    datasetContents: Map<string, string[]> = new Map()
    topicsMentioned: Map<string, TopicMentionedProps[]> = new Map()
    s3files: Map<string, string> = new Map()
    requires: Map<string, string[]> = new Map() // mapea un uri a una lista de uris que sabemos que ese contenido requiere que fetcheemos
    notifications: Map<string, NotificationQueryResult> = new Map()
    topicsDatasets: Map<string, { id: string, props: TopicProp[] }[]> = new Map()
    rootCreationDates: Map<string, Date> = new Map()

    bskyBasicUsers: Map<string, $Typed<ProfileViewBasic>> = new Map()
    bskyDetailedUsers: Map<string, $Typed<ProfileViewDetailed>> = new Map()
    caUsers: Map<string, CAProfile> = new Map()
    profiles: Map<string, ArCabildoabiertoActorDefs.ProfileViewDetailed> = new Map()
    profileViewers: Map<string, AppBskyActorDefs.ViewerState> = new Map()

    constructor(ctx: AppContext, agent?: SessionAgent | NoSessionAgent) {
        this.ctx = ctx
        this.agent = agent ?? new NoSessionAgent(
            new AtpBaseClient(`${env.HOST}:${env.PORT}`),
            new AtpBaseClient(bskyPublicAPI)
        )
    }

    async fetchCAContentsAndBlobs(uris: string[]) {
        const t1 = Date.now()
        await this.fetchCAContents(uris)
        const t2 = Date.now()

        const contents = Array.from(this.caContents?.values() ?? [])
        const blobRefs = blobRefsFromContents(contents
            .filter(c => c.text == null)
        )

        const datasets = contents.reduce((acc, cur) => {
            return [...acc, ...(cur.datasetsUsed.map(d => d.uri) ?? [])]
        }, [] as string[])

        const filters = contents.reduce((acc, cur) => {
            const filtersInContent: $Typed<ColumnFilter>[][] = []
            const record = cur.record ? JSON.parse(cur.record) : null
            if (!record) return acc

            const collection = getCollectionFromUri(cur.uri)

            if (isArticle(collection)) {
                const articleRecord = record as ArticleRecord
                if (articleRecord.embeds) {
                    articleRecord.embeds.forEach(e => {
                        if (isVisualizationEmbed(e.value)) {
                            if (e.value.filters) {
                                filtersInContent.push(e.value.filters.filter(isColumnFilter))
                            }
                        }
                    })
                }
            } else if (isPost(collection)) {
                const postRecord = record as AppBskyFeedPost.Record
                if (postRecord.embed && isVisualizationEmbed(postRecord.embed)) {
                    if (postRecord.embed.filters) {
                        filtersInContent.push(postRecord.embed.filters.filter(isColumnFilter))
                    }
                }
            }
            return [...acc, ...filtersInContent]
        }, [] as $Typed<ColumnFilter>[][])

        await Promise.all([
            this.fetchDatasetsHydrationData(datasets),
            this.fetchDatasetContents(datasets),
            this.fetchTextBlobs(blobRefs),
            this.fetchFilteredTopics(filters)
        ])
        const t3 = Date.now()
        this.ctx.logger.logTimes("fetch ca contents and blobs", [t1, t2, t3])
    }

    async fetchCAContents(uris: string[]) {
        uris = uris.filter(u => !this.caContents?.has(u))
        if (uris.length == 0) return

        this.ctx.logger.pino.info({included: uris.includes('at://did:plc:oky5czdrnfjpqslsw2a5iclo/app.bsky.feed.post/3lzduaypsv22f')},
            "fetching ca contents")

        const contents = await this.ctx.kysely
            .selectFrom("Record")
            .where("Record.uri", "in", uris)
            .leftJoin("Content", "Content.uri", "Record.uri")
            .leftJoin("Article", "Article.uri", "Record.uri")
            .leftJoin("TopicVersion", "TopicVersion.uri", "Record.uri")

            .select([
                "Record.uri",
                "Record.cid",
                "Record.created_at",
                "Record.uniqueLikesCount",
                "Record.uniqueRepostsCount",
                eb => eb
                    .selectFrom("Post as Reply")
                    .select(eb => eb.fn.count<number>("Reply.uri").as("count"))
                    .whereRef("Reply.replyToId", "=", "Record.uri").as("repliesCount"),
                eb => eb
                    .selectFrom("Post as Quote")
                    .select(eb => eb.fn.count<number>("Quote.uri").as("count"))
                    .whereRef("Quote.quoteToId", "=", "Record.uri").as("quotesCount"),
                "Record.record",
                "Content.text",
                "Content.selfLabels",
                "Content.embeds",
                "Content.dbFormat",
                "Content.format",
                "Content.textBlobId",
                "Article.title",
                "TopicVersion.topicId",
                "TopicVersion.props",
                eb => jsonArrayFrom(eb
                    .selectFrom("_ContentToDataset")
                    .select("_ContentToDataset.B as uri")
                    .whereRef("_ContentToDataset.A", "=", "Content.uri")
                ).as("datasetsUsed")

            ])
            .execute()


        contents.forEach(c => {
            this.ctx.logger.pino.info({uri: c.uri, created_at: c.created_at.toISOString()}, "got ca content")
            if (c.cid) {
                this.caContents.set(c.uri, {
                    ...c,
                    repliesCount: c.repliesCount ? Number(c.repliesCount) : 0,
                    quotesCount: c.quotesCount ? Number(c.quotesCount) : 0,
                    cid: c.cid,
                    selfLabels: c.selfLabels ?? []
                })
            } else {
                this.ctx.logger.pino.warn({uri: c.uri}, "content ignored, no cid")
            }
        })
    }

    async fetchTextBlobs(blobs: BlobRef[]) {
        const batchSize = 100
        let texts: (string | null)[] = []
        for (let i = 0; i < blobs.length; i += batchSize) {
            const batchTexts = await fetchTextBlobs(this.ctx, blobs.slice(i, i + batchSize))
            texts.push(...batchTexts)
        }
        const keys = blobs.map(b => getBlobKey(b))

        const entries: [string, string | null][] = texts.map((t, i) => [keys[i], t])
        const m = removeNullValues(new Map<string, string | null>(entries))
        this.textBlobs = joinMaps(this.textBlobs, m)
    }

    async fetchPostAndArticleViewsHydrationData(uris: string[], otherDids: string[] = []) {
        const required = uris.flatMap(u => this.requires.get(u)).filter(x => x != null)
        uris = unique([...uris, ...required])
        const dids = unique([...uris.map(getDidFromUri), ...otherDids])

        const t1 = Date.now()
        await Promise.all([
            this.fetchBskyPosts(postUris(uris)),
            this.fetchCAContentsAndBlobs(uris),
            this.fetchEngagement(uris),
            this.fetchTopicsBasicByUris(topicVersionUris(uris)),
            this.fetchUsersHydrationData(dids)
        ])
        const t2 = Date.now()
        this.ctx.logger.logTimes("fetch posts and article views", [t1, t2])
    }

    async fetchTopicsBasicByUris(uris: string[]) {
        uris = uris.filter(u => !this.topicsByUri?.has(u))
        if (uris.length == 0) return

        const data: TopicVersionQueryResultBasic[] = await this.ctx.kysely
            .selectFrom("TopicVersion")
            .innerJoin("Topic", "Topic.id", "TopicVersion.topicId")
            .innerJoin("TopicVersion as CurrentVersion", "CurrentVersion.uri", "Topic.currentVersionId")
            .innerJoin("Content", "TopicVersion.uri", "Content.uri")
            .select([
                "TopicVersion.uri",
                "Topic.id",
                "Topic.popularityScoreLastDay",
                "Topic.popularityScoreLastWeek",
                "Topic.popularityScoreLastMonth",
                "Topic.lastEdit",
                "CurrentVersion.props",
                "Content.numWords"
            ])
            .where("TopicVersion.uri", "in", uris)
            .execute()

        const mapByUri = new Map(data.map(item => [item.uri, item]))

        this.topicsByUri = joinMaps(this.topicsByUri, mapByUri)
    }

    async expandUrisWithRepliesAndReposts(skeleton: FeedSkeleton): Promise<string[]> {
        const uris = skeleton.map(e => e.post)
        const repostUris = skeleton
            .map(e => e.reason && isSkeletonReasonRepost(e.reason) ? e.reason.repost : null)
            .filter(x => x != null)

        const t1 = Date.now()
        const pUris = postUris(uris)

        const caPosts = (await Promise.all([
            this.fetchBskyPosts(pUris),
            pUris.length > 0 ? this.ctx.kysely
                .selectFrom("Post")
                .select(["uri", "replyToId", "rootId"])
                .where("uri", "in", pUris)
                .execute() : []
        ]))[1]
        const t2 = Date.now()

        this.ctx.logger.logTimes("expanding uris with replies and reposts", [t1, t2])

        const bskyPosts = uris
            .map(u => this.bskyPosts?.get(u))
            .filter(x => x != null)

        return unique([
            ...uris,
            ...repostUris,
            ...caPosts.map(p => p.replyToId),
            ...caPosts.map(p => p.rootId),
            ...bskyPosts.map(p => (p.record as AppBskyFeedPost.Record).reply?.root?.uri),
            ...bskyPosts.map(p => (p.record as AppBskyFeedPost.Record).reply?.parent?.uri),
            // faltan quote posts
        ].filter(x => x != null))
    }

    async fetchFeedHydrationData(skeleton: FeedSkeleton) {
        const expandedUris = await this.expandUrisWithRepliesAndReposts(skeleton)

        await Promise.all([
            this.fetchPostAndArticleViewsHydrationData(expandedUris),
            this.fetchRepostsHydrationData(expandedUris),
            this.fetchRootCreationDate(skeleton.map(s => s.post))
        ])
    }


    async fetchRootCreationDate(uris: string[]) {
        uris = uris.filter(u => isPost(getCollectionFromUri(u)))
        if (uris.length == 0) return

        const t1 = Date.now()
        const rootCreationDates = await this.ctx.kysely
            .selectFrom("Post")
            .innerJoin("Record", "Record.uri", "Post.rootId")
            .select(["Post.uri", "Record.created_at"])
            .where("Post.uri", "in", uris)
            .execute()
        const t2 = Date.now()
        this.ctx.logger.logTimes("root creation dates", [t1, t2])

        rootCreationDates.forEach(r => {
            this.rootCreationDates.set(r.uri, r.created_at)
        })
    }


    async fetchRepostsHydrationData(uris: string[]) {
        uris = uris.filter(u => getCollectionFromUri(u) == "app.bsky.feed.repost")
        if (uris.length > 0) {
            const t1 = Date.now()

            const reposts: RepostQueryResult[] = await this.ctx.kysely
                .selectFrom("Reaction")
                .innerJoin("Record", "Reaction.uri", "Record.uri")
                .select([
                    "Record.uri",
                    "Record.created_at",
                    "Reaction.subjectId"
                ])
                .where("Reaction.uri", "in", uris)
                .execute()

            const t2 = Date.now()
            this.ctx.logger.logTimes("fetch reposts", [t1, t2])
            reposts.forEach(r => {
                if (r.subjectId) {
                    this.reposts.set(r.subjectId, r)
                }
            })
        }
    }


    addEmbedsToPostsMap(m: Map<string, BskyPostView>) {
        const posts = Array.from(m.values())
        posts.forEach(post => {
            if (post.embed && isEmbedRecordView(post.embed) && isViewRecord(post.embed.record)) {
                const record = post.embed.record
                const collection = getCollectionFromUri(record.uri)
                if (isPost(collection) && !m.has(record.uri)) {
                    m.set(record.uri, {
                        ...record,
                        uri: record.uri,
                        cid: record.cid,
                        $type: "app.bsky.feed.defs#postView",
                        author: {
                            ...record.author
                        },
                        indexedAt: record.indexedAt,
                        record: record.value,
                        embed: record.embeds && record.embeds.length > 0 ? record.embeds[0] : undefined
                    })
                }
            } else if (post.embed && isEmbedRecordWithMediaView(post.embed)) {
                const recordView = post.embed.record
                if (isEmbedRecordView(recordView) && isViewRecord(recordView.record)) {
                    const record = recordView.record
                    if(!m.has(record.uri)){
                        m.set(record.uri, {
                            ...record,
                            uri: record.uri,
                            cid: record.cid,
                            $type: "app.bsky.feed.defs#postView",
                            author: {
                                ...record.author
                            },
                            indexedAt: record.indexedAt,
                            record: record.value,
                            embed: record.embeds && record.embeds.length > 0 ? record.embeds[0] : undefined
                        })
                    }
                }
            } else if (post.embed && isEmbedRecordView(post.embed) && isViewNotFound(post.embed.record)) {
                const uri = post.embed.record.uri
                const collection = getCollectionFromUri(uri)
                if (isArticle(collection)) {
                    this.requires.set(post.uri, [...(this.requires.get(post.uri) ?? []), uri])
                }
            }
        })

        return m
    }

    async fetchBskyPosts(uris: string[]) {
        uris = uris.filter(u => !this.bskyPosts?.has(u))
        const agent = this.agent

        const postsList = postUris(uris)
        if (postsList.length == 0) return

        const batches: string[][] = []
        for (let i = 0; i < postsList.length; i += 25) {
            batches.push(postsList.slice(i, i + 25))
        }
        let postViews: PostView[] = []
        try {
            const t1 = Date.now()
            if (batches.length > 1) console.log(`Warning: get bsky posts has ${batches.length} batches.`)
            for (const b of batches) {
                const res = await agent.bsky.app.bsky.feed.getPosts({uris: b})
                postViews.push(...res.data.posts)
            }
            const t2 = Date.now()
            this.ctx.logger.logTimes("fetch bsky posts", [t1, t2])
        } catch (err) {
            console.log("Error fetching posts", err)
            console.log("uris", uris)
            return
        }

        let m = new Map<string, BskyPostView>(
            postViews.map(item => [item.uri, item])
        )

        m = this.addEmbedsToPostsMap(m)
        this.addAuthorsFromPostViews(Array.from(m.values()))

        this.bskyPosts = joinMaps(this.bskyPosts, m)
    }

    addAuthorsFromPostViews(posts: PostView[]) {
        posts.forEach(p => {
            if (!this.bskyBasicUsers.has(p.author.did)) {
                this.bskyBasicUsers.set(p.author.did, {
                    ...p.author,
                    $type: "app.bsky.actor.defs#profileViewBasic"
                })
            }
        })
    }

    getFetchedBlob(blob: BlobRef): string | null {
        const key = getBlobKey(blob)
        return this.textBlobs?.get(key) ?? null
    }

    async fetchEngagement(uris: string[]) {
        const agent = this.agent
        if (!agent.hasSession()) return
        if (uris.length == 0) return

        const did = agent.did
        const t1 = Date.now()
        const reactions = await this.ctx.kysely
            .selectFrom("Reaction")
            .innerJoin("Record", "Record.uri", "Reaction.uri")
            .select([
                "Reaction.uri",
                "Reaction.subjectId"
            ])
            .where("Record.authorId", "=", did)
            .where("Record.collection", "in", ["app.bsky.feed.like", "app.bsky.feed.repost"])
            .where("Reaction.subjectId", "in", uris)
            .execute()
        const t2 = Date.now()
        this.ctx.logger.logTimes("fetch engagement", [t1, t2])

        reactions.forEach(l => {
            if (l.subjectId) {
                if (getCollectionFromUri(l.uri) == "app.bsky.feed.like") {
                    if (!this.likes.has(l.subjectId)) this.likes.set(l.subjectId, l.uri)
                }
                if (getCollectionFromUri(l.uri) == "app.bsky.feed.repost") {
                    if (!this.reposts.has(l.subjectId)) this.reposts.set(l.subjectId, {
                        uri: l.uri,
                        created_at: null,
                        subjectId: l.subjectId
                    })
                }
            }
        })
    }

    async fetchThreadHydrationData(skeleton: ThreadSkeleton) {
        let uris = getUrisFromThreadSkeleton(skeleton)

        const reqUris = uris
            .map(u => this.requires.get(u))
            .filter(x => x != null)
            .flatMap(x => x)

        uris = unique([...uris, ...reqUris])

        uris.forEach(u => {
            const r = this.requires.get(u)
            if (r) uris.push()
        })

        const c = getCollectionFromUri(skeleton.post)

        const dids = uris.map(u => getDidFromUri(u))

        await Promise.all([
            this.fetchPostAndArticleViewsHydrationData(uris),
            this.fetchUsersHydrationData(dids),
            isArticle(c) ? this.fetchTopicsMentioned(skeleton.post) : null,
            isDataset(c) ? this.fetchDatasetsHydrationData([skeleton.post]) : null,
            isDataset(c) ? this.fetchDatasetContents([skeleton.post]) : null
        ])
    }

    storeFeedViewPosts(feed: FeedViewPost[]) {
        const m = new Map<string, PostView>()
        feed.forEach(f => {
            m.set(f.post.uri, f.post)
            if (f.reply) {
                if (isPostView(f.reply.parent)) {
                    if (!m.has(f.reply.parent.uri)) {
                        m.set(f.reply.parent.uri, f.reply.parent)
                    }
                }
                if (isPostView(f.reply.root)) {
                    if (!m.has(f.reply.root.uri)) {
                        m.set(f.reply.root.uri, f.reply.root)
                    }
                }
            }
            if (f.reason) {
                if (isReasonRepost(f.reason) && f.post.uri) {
                    this.reposts.set(f.post.uri, {
                        created_at: new Date(f.reason.indexedAt),
                        subjectId: f.post.uri
                    })
                }
            }
        })
        this.addEmbedsToPostsMap(m)
        this.bskyPosts = joinMaps(this.bskyPosts, m)
        this.addAuthorsFromPostViews(Array.from(m.values()))
    }

    async fetchDatasetsHydrationData(uris: string[]) {
        uris = uris.filter(u => !this.datasets?.has(u))
        if (uris.length == 0) return

        const datasetsQuery = this.ctx.kysely
            .selectFrom("Dataset")
            .innerJoin("Record", "Record.uri", "Dataset.uri")
            .where("Record.cid", "is not", null)
            .where("Record.record", "is not", null)
            .select([
                "Dataset.uri",
                "Record.cid",
                "Record.created_at",
                "Dataset.title",
                "Dataset.columns",
                "Dataset.description",
                eb => jsonArrayFrom(eb
                    .selectFrom("DataBlock")
                    .innerJoin("Blob", "DataBlock.cid", "Blob.cid")
                    .whereRef("DataBlock.datasetId", "=", "Dataset.uri")
                    .select([
                        "Blob.cid",
                        "DataBlock.format"
                    ])
                ).as("dataBlocks")
            ])
            .where("Dataset.uri", "in", uris)
            .execute()

        const dids = unique(uris.map(getDidFromUri))

        const [datasets] = await Promise.all([
            datasetsQuery,
            this.fetchUsersHydrationData(dids)
        ])

        for (const d of datasets) {
            if (d.cid) {
                this.datasets.set(d.uri, {
                    ...d,
                    cid: d.cid
                })
            }
        }
    }

    async fetchDatasetContents(uris: string[]) {
        uris = uris.filter(u => isDataset(getCollectionFromUri(u)))
        uris = uris.filter(u => !this.datasetContents?.has(u))

        if (uris.length == 0) return

        await this.fetchDatasetsHydrationData(uris)

        const blobs: { blobRef: BlobRef, datasetUri: string }[] = []

        for (let i = 0; i < uris.length; i++) {
            const uri = uris[i]
            const d = this.datasets?.get(uri)
            if (!d) return

            const authorId = getDidFromUri(uri)
            const blocks = d.dataBlocks

            blobs.push(...blocks.map(b => {
                return {
                    blobRef: {
                        cid: b.cid,
                        authorId
                    },
                    datasetUri: uri
                }
            }))
        }

        const contents = (await fetchTextBlobs(this.ctx, blobs.map(b => b.blobRef)))
            .filter(c => c != null)

        const datasetContents = new Map<string, string[]>()
        for (let i = 0; i < blobs.length; i++) {
            const uri = blobs[i].datasetUri
            const content = contents[i]
            const cur = datasetContents.get(uri)
            if (!cur) {
                datasetContents.set(uri, [content])
            } else {
                cur.push(content)
            }
        }

        this.datasetContents = joinMaps(this.datasetContents, datasetContents)
    }


    async fetchTopicsMentioned(uri: string) {

        const topics: TopicMentionedProps[] = await this.ctx.kysely
            .selectFrom("Reference")
            .innerJoin("Topic", "Reference.referencedTopicId", "Topic.id")
            .innerJoin("TopicVersion", "Topic.currentVersionId", "TopicVersion.uri")
            .select([
                "count",
                "Topic.id",
                "TopicVersion.props"
            ])
            .where("Reference.referencingContentId", "=", uri)
            .execute()

        if (!this.topicsMentioned) this.topicsMentioned = new Map()
        this.topicsMentioned.set(uri, topics)
    }

    async fetchUsersHydrationDataFromCA(dids: string[]) {
        dids = unique(dids.filter(d => !this.caUsers.has(d)))
        if (dids.length == 0) return

        const t1 = Date.now()

        const profiles = await this.ctx.kysely
            .selectFrom("User")
            .select([
                "User.did",
                "User.CAProfileUri",
                "editorStatus",
                "userValidationHash",
                "orgValidation",
                (eb) =>
                    eb
                        .selectFrom("Follow")
                        .innerJoin("Record", "Record.uri", "Follow.uri")
                        .innerJoin("User", "User.did", "Record.authorId")
                        .select(eb.fn.countAll<number>().as("count"))
                        .where("User.inCA", "=", true)
                        .whereRef("Follow.userFollowedId", "=", "User.did")
                        .as("followersCount"),
                (eb) =>
                    eb
                        .selectFrom("Record")
                        .whereRef("Record.authorId", "=", "User.did")
                        .innerJoin("Follow", "Follow.uri", "Record.uri")
                        .innerJoin("User as UserFollowed", "UserFollowed.did", "Follow.userFollowedId")
                        .where("UserFollowed.inCA", "=", true)
                        .select(eb.fn.countAll<number>().as("count"))
                        .as("followsCount"),
                (eb) =>
                    eb
                        .selectFrom("Record")
                        .innerJoin("Article", "Article.uri", "Record.uri")
                        .select(eb.fn.countAll<number>().as("count"))
                        .whereRef("Record.authorId", "=", "User.did")
                        .where("Record.collection", "=", "ar.cabildoabierto.feed.article")
                        .as("articlesCount"),
                (eb) =>
                    eb
                        .selectFrom("Record")
                        .innerJoin("TopicVersion", "TopicVersion.uri", "Record.uri")
                        .select(eb.fn.countAll<number>().as("count"))
                        .whereRef("Record.authorId", "=", "User.did")
                        .where("Record.collection", "=", "ar.cabildoabierto.wiki.topicVersion")
                        .as("editsCount"),
            ])
            .where("User.did", "in", dids)
            .execute()

        if (profiles.length == 0) return null

        const formattedProfiles: CAProfile[] = profiles.map(profile => {
            if(profile.CAProfileUri){
                return {
                    did: profile.did,
                    editorStatus: profile.editorStatus,
                    caProfile: profile.CAProfileUri,
                    followsCount: profile.followsCount ?? 0,
                    followersCount: profile.followersCount ?? 0,
                    articlesCount: profile.articlesCount ?? 0,
                    editsCount: profile.editsCount ?? 0,
                    verification: getValidationState(profile)
                }
            }
            return null
        }).filter(x => x != null)

        formattedProfiles.forEach(p => {
            this.caUsers.set(p.did, p)
        })

        const t2 = Date.now()
        this.ctx.logger.logTimes(`fetch users data from ca (N = ${dids.length})`, [t1, t2])
    }

    async fetchUsersDetailedHydrationDataFromBsky(dids: string[]) {
        const agent = this.agent

        dids = unique(dids.filter(d => !this.bskyDetailedUsers.has(d)))
        if (dids.length == 0) return

        const t1 = Date.now()
        const didBatches: string[][] = []
        for (let i = 0; i < dids.length; i += 25) didBatches.push(dids.slice(i, i + 25))
        const profiles: ProfileViewDetailed[] = []
        for (let i = 0; i < didBatches.length; i++) {
            const b = didBatches[i]
            const res = await agent.bsky.app.bsky.actor.getProfiles({actors: b})
            profiles.push(...res.data.profiles)
        }

        this.bskyDetailedUsers = joinMaps(
            this.bskyDetailedUsers,
            new Map(profiles.map(v => [v.did, {...v, $type: "app.bsky.actor.defs#profileViewDetailed"}]))
        )
        this.bskyBasicUsers = joinMaps(
            this.bskyBasicUsers,
            new Map(profiles.map(v => [v.did, {...v, $type: "app.bsky.actor.defs#profileViewBasic"}]))
        )
        const t2 = Date.now()
        this.ctx.logger.logTimes(`fetch users data from bsky (N = ${dids.length})`, [t1, t2])
    }


    async fetchProfilesViewerState(dids: string[]){
        const {agent, ctx} = this
        if(!agent.hasSession()) {
            dids.forEach(d => {
                this.profileViewers.set(d, {})
            })
            return
        }

        const t1 = Date.now()

        const follows = await ctx.kysely
            .selectFrom("Follow")
            .innerJoin("Record", "Record.uri", "Follow.uri")
            .select("Follow.uri")
            .where(eb => eb.or([
                eb.and([
                    eb("Follow.userFollowedId", "in", dids),
                    eb("Record.authorId", "=", agent.did),
                ]),
                eb.and([
                    eb("Follow.userFollowedId", "=", agent.did),
                    eb("Record.authorId", "in", dids)
                ])
            ]))
            .execute()

        ctx.logger.logTimes("fetch profiles viewer state", [t1, Date.now()])

        dids.forEach(did => {
            const following = follows.find(f => getDidFromUri(f.uri) == agent.did)
            const followedBy = follows.find(f => getDidFromUri(f.uri) == did)

            this.profileViewers.set(did, {
                following: following ? following.uri : undefined,
                followedBy: followedBy ? followedBy.uri : undefined
            })
        })
    }

    async fetchUsersHydrationData(dids: string[]) {
        if(dids.length == 0) return

        const [profiles] = await Promise.all([
            this.ctx.redisCache.profile.getMany(dids),
            this.fetchProfilesViewerState(dids)
        ])

        profiles.forEach(p => {
            if(p) {
                this.profiles.set(p.did, p)
            }
        })

        const missedDids = dids.filter((_, i) => {
            return profiles[i] == null
        })
        if(missedDids.length == 0) return

        await Promise.all([
            this.fetchUsersHydrationDataFromCA(missedDids),
            this.fetchUsersDetailedHydrationDataFromBsky(missedDids)
        ])

        const newProfiles: ArCabildoabiertoActorDefs.ProfileViewDetailed[] = missedDids
            .map(d => hydrateProfileView(this.ctx, d, this))
            .filter(x => x != null)

        newProfiles.forEach(p => {
            this.profiles.set(p.did, p)
        })

        await this.ctx.redisCache.profile.setMany(newProfiles)
    }

    async fetchFilesFromStorage(filePaths: string[], bucket: string) {
        for (let i = 0; i < filePaths.length; i++) {
            const path = filePaths[i]
            const {data} = await this.ctx.storage.download(path, bucket)

            if (data) {
                const buffer = data.file
                const base64 = Buffer.from(buffer).toString('base64')
                const mimeType = data.contentType

                const fullBase64 = `data:${mimeType};base64,${base64}`
                this.s3files.set(bucket + ":" + path, fullBase64)
            }
        }
    }


    async fetchNotificationsHydrationData(skeleton: NotificationsSkeleton) {
        if (!this.agent.hasSession() || skeleton.length == 0) return

        const reqAuthors = skeleton.map(n => getDidFromUri(n.causedByRecordId))

        const caNotificationsData: NotificationQueryResult[] = (await Promise.all([
            this.ctx.kysely
                .selectFrom("Notification")
                .innerJoin("Record", "Notification.causedByRecordId", "Record.uri")
                .leftJoin("TopicVersion", "Notification.reasonSubject", "TopicVersion.uri")
                .select([
                    "Notification.id",
                    "Notification.userNotifiedId",
                    "Notification.causedByRecordId",
                    "Notification.message",
                    "Notification.moreContext",
                    "Notification.created_at",
                    "Notification.type",
                    "Notification.reasonSubject",
                    "Record.cid",
                    "Record.record",
                    "TopicVersion.topicId"
                ])
                .where("userNotifiedId", "=", this.agent.did)
                .orderBy("created_at", "desc")
                .limit(20)
                .execute(),
            this.fetchUsersHydrationData(reqAuthors)
        ]))[0]

        caNotificationsData.forEach(n => {
            this.notifications.set(n.id, n)
        })
    }


    async fetchFilteredTopics(manyFilters: $Typed<ColumnFilter>[][]) {
        const datasets = await Promise.all(manyFilters.map(async filters => {

            const filtersByOperator = new Map<string, { column: string, operands: string[] }[]>()
            filters.forEach(f => {
                if (["includes", "=", "in"].includes(f.operator) && f.operands && f.operands.length > 0) {
                    const cur = filtersByOperator.get(f.operator) ?? []
                    filtersByOperator.set(f.operator, [...cur, {column: f.column, operands: f.operands}])
                }
            })

            if (filtersByOperator.size > 0) {
                let query = this.ctx.kysely
                    .selectFrom('Topic')
                    .innerJoin('TopicVersion', 'TopicVersion.uri', 'Topic.currentVersionId')
                    .select(['id', 'TopicVersion.props'])

                const includesFilters = filtersByOperator.get("includes")
                if (includesFilters) {
                    query = query.where((eb) =>
                        eb.and(includesFilters.map(f => stringListIncludes(f.column, f.operands[0])))
                    )
                }

                const equalFilters = filtersByOperator.get("=")
                if (equalFilters) {
                    query = query.where((eb) =>
                        eb.and(equalFilters.map(f => equalFilterCond(f.column, f.operands[0])))
                    )
                }

                const inFilters = filtersByOperator.get("in")
                if (inFilters) {
                    query = query.where((eb) =>
                        eb.and(inFilters.map(f => inFilterCond(f.column, f.operands)))
                    )
                }

                return await query
                    .execute() as { id: string, props: TopicProp[] }[]
            } else {
                return null
            }
        }))

        datasets.forEach((d, index) => {
            if (d) {
                this.topicsDatasets.set(getObjectKey(manyFilters[index]), d)
            }
        })
    }

    saveDataFromPostThread(thread: ThreadViewPost, includeParents: boolean, excludeChild?: string) {
        if (thread.post) {
            this.addAuthorsFromPostViews([thread.post])
            this.bskyPosts.set(thread.post.uri, thread.post)
            this.addEmbedsToPostsMap(this.bskyPosts)

            if (includeParents && thread.parent && isThreadViewPost(thread.parent)) {
                this.saveDataFromPostThread(thread.parent, true, thread.post.uri)
            }

            if (thread.replies) {
                thread.replies.forEach(r => {
                    if (isThreadViewPost(r)) {
                        if (r.post.uri != excludeChild) {
                            this.saveDataFromPostThread(r, true)
                        }
                    } else {
                        console.log("reply is not post view")
                        prettyPrintJSON(r)
                    }
                })
            }
        } else {
            console.log("thread->post no es postView:")
            prettyPrintJSON(thread.post)
        }
    }
}