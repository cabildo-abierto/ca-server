import {AppContext} from "#/index";
import {NoSessionAgent, SessionAgent} from "#/utils/session-agent";
import {PostView as BskyPostView} from "#/lex-server/types/app/bsky/feed/defs";
import {ProfileViewBasic, ProfileViewDetailed} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {
    BlobRef, ThreadSkeleton
} from "#/services/hydration/hydrate";
import {FeedSkeleton} from "#/services/feed/feed";
import {getObjectKey, gett, removeNullValues, unique} from "#/utils/arrays";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post";
import {
    articleUris,
    getCollectionFromUri,
    getDidFromUri,
    isArticle,
    isDataset,
    isPost,
    postUris,
    topicVersionUris
} from "#/utils/uri";
import {$Typed, AppBskyEmbedRecord} from "@atproto/api";
import {ViewRecord} from "@atproto/api/src/client/types/app/bsky/embed/record";
import {TopicQueryResultBasic} from "#/services/wiki/topics";
import {reactionsQuery, recordQuery} from "#/utils/utils";
import {isMain as isVisualizationEmbed} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {
    FeedViewPost,
    isPostView, isReasonRepost,
    isSkeletonReasonRepost, isThreadViewPost,
    PostView, ThreadViewPost
} from "@atproto/api/dist/client/types/app/bsky/feed/defs";
import {fetchTextBlobs} from "#/services/blob";
import {Prisma} from "@prisma/client";
import {env} from "#/lib/env";
import {AtpBaseClient} from "#/lex-api";
import {RepostQueryResult} from "#/services/feed/inicio/following";
import {isView as isEmbedRecordView} from "#/lex-api/types/app/bsky/embed/record"
import {isView as isEmbedRecordWithMediaView} from "#/lex-api/types/app/bsky/embed/recordWithMedia"
import {isViewNotFound, isViewRecord} from "#/lex-api/types/app/bsky/embed/record";
import {NotificationQueryResult, NotificationsSkeleton} from "#/services/notifications/notifications";
import {stringListIncludes} from "#/services/dataset/read";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article"

import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"

import {
    ColumnFilter,
    isColumnFilter
} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {getUrisFromThreadSkeleton} from "#/services/thread/thread";

function getUriFromEmbed(embed: PostView["embed"]): string | null {
    if (isEmbedRecordView(embed)) {
        if (isViewRecord(embed.record)) {
            return embed.record.uri
        } else if (isViewNotFound(embed.record)) {
            return embed.record.uri
        }
    } else if (isEmbedRecordWithMediaView(embed)) {
        if (isViewRecord(embed.record.record)) {
            return embed.record.record.uri
        } else if (isViewNotFound(embed.record.record)) {
            return embed.record.record.uri
        }
    }
    return null
}


export type FeedElementQueryResult = {
    uri: string
    cid: string
    createdAt: Date | string,
    record: string | null
    _count: {
        replies: number
    }
    uniqueLikesCount: number
    uniqueRepostsCount: number
    content: {
        text: string | null
        textBlobId?: string | null
        format?: string | null
        selfLabels: string[]
        article?: {
            title: string
        } | null
        topicVersion?: {
            props: Prisma.JsonValue | null
            topicId: string
        } | null
        datasetsUsed: { uri: string }[]
        embeds: Prisma.JsonValue | null
    } | null
}


export type DatasetQueryResult = {
    uri: string
    cid: string | null
    createdAt: Date | string,
    record: string | null
    author: {
        did: string
        handle: string | null
        displayName: string | null
        avatar: string | null
        CAProfileUri: string | null
        userValidationHash: string | null
        orgValidation: string | null
    }
    dataset: {
        title: string
        description: string | null
        columns: string[]
        dataBlocks: {
            blob: {
                cid: string
            } | null
            format: string | null
        }[]
    } | null
}


export type TopicMentionedProps = {
    referencedTopic: {
        id: string
        currentVersion: {
            props: Prisma.JsonValue
        } | null
    }
    count: number
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
    bskyUsers: Map<string, $Typed<ProfileViewBasic> | $Typed<ProfileViewDetailed>> = new Map()
    caUsers: Map<string, CAProfileViewBasic> = new Map()
    topicsByUri: Map<string, TopicQueryResultBasic> = new Map()
    topicsById: Map<string, TopicQueryResultBasic> = new Map()
    textBlobs: Map<string, string> = new Map()
    datasets: Map<string, DatasetQueryResult> = new Map()
    datasetContents: Map<string, string[]> = new Map()
    topicsMentioned: Map<string, TopicMentionedProps[]> = new Map()
    sbFiles: Map<string, string> = new Map()
    requires: Map<string, string[]> = new Map() // mapea un uri a una lista de uris que sabemos que ese contenido requiere que fetcheemos
    notifications: Map<string, NotificationQueryResult> = new Map()
    topicsDatasets: Map<string, {id: string, props: TopicProp[]}[]> = new Map()
    rootCreationDates: Map<string, Date> = new Map()

    constructor(ctx: AppContext, agent?: SessionAgent | NoSessionAgent) {
        this.ctx = ctx
        this.agent = agent ?? new NoSessionAgent(
            new AtpBaseClient(`${env.HOST}:${env.PORT}`),
            new AtpBaseClient("https://bsky.social")
        )
    }

    async fetchCAContentsAndBlobs(uris: string[]) {
        await this.fetchCAContents(uris)

        const contents = Array.from(this.caContents?.values() ?? [])
        const blobRefs = blobRefsFromContents(contents
            .filter(c => c.content && c.content.text == null)
        )

        const datasets = contents.reduce((acc, cur) => {
            return [...acc, ...cur.content?.datasetsUsed.map(d => d.uri) ?? []]
        }, [] as string[])

        const filters = contents.reduce((acc, cur) => {
            const filtersInContent: $Typed<ColumnFilter>[][] = []
            const record = cur.record ? JSON.parse(cur.record) : null
            if(!record) return acc

            const collection = getCollectionFromUri(cur.uri)

            if(isArticle(collection)){
                const articleRecord = record as ArticleRecord
                if(articleRecord.embeds){
                    articleRecord.embeds.forEach(e => {
                        if(isVisualizationEmbed(e.value)){
                            if(e.value.filters){
                                filtersInContent.push(e.value.filters.filter(isColumnFilter))
                            }
                        }
                    })
                }
            } else if(isPost(collection)){
                const postRecord = record as PostRecord
                if(postRecord.embed && isVisualizationEmbed(postRecord.embed)){
                    if(postRecord.embed.filters){
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
    }

    async fetchCAContents(uris: string[]) {
        uris = uris.filter(u => !this.caContents?.has(u))
        if (uris.length == 0) return

        const posts = postUris(uris)
        const articles = articleUris(uris)
        const topicVersions = topicVersionUris(uris)

        const [postContents, articleContents, topicVersionContents] = await Promise.all([
            posts.length > 0 ? this.ctx.db.record.findMany({
                select: {
                    uri: true,
                    cid: true,
                    createdAt: true,
                    ...reactionsQuery,
                    record: true,
                    content: {
                        select: {
                            text: true,
                            selfLabels: true,
                            embeds: true,
                            datasetsUsed: {
                                select: {uri: true}
                            }
                        }
                    }
                },
                where: {
                    uri: {
                        in: posts
                    }
                }
            }) : [],
            articles.length > 0 ? this.ctx.db.record.findMany({
                select: {
                    uri: true,
                    cid: true,
                    createdAt: true,
                    ...reactionsQuery,
                    record: true,
                    content: {
                        select: {
                            text: true,
                            format: true,
                            textBlobId: true,
                            selfLabels: true,
                            embeds: true,
                            article: {
                                select: {
                                    title: true
                                }
                            },
                            datasetsUsed: {
                                select: {uri: true}
                            }
                        }
                    }
                },
                where: {
                    uri: {
                        in: articles
                    }
                }
            }) : [],
            topicVersions.length > 0 ? this.ctx.db.record.findMany({
                select: {
                    uri: true,
                    cid: true,
                    createdAt: true,
                    ...reactionsQuery,
                    record: true,
                    content: {
                        select: {
                            text: true,
                            format: true,
                            selfLabels: true,
                            textBlobId: true,
                            embeds: true,
                            topicVersion: {
                                select: {
                                    props: true,
                                    topicId: true
                                }
                            },
                            datasetsUsed: {
                                select: {uri: true}
                            }
                        }
                    }
                },
                where: {
                    uri: {
                        in: topicVersions
                    }
                }
            }) : []
        ])

        let contents: FeedElementQueryResult[] = []

        const res = [...postContents, ...articleContents, ...topicVersionContents]

        res.forEach(r => {
            if (r.cid) {
                contents.push({
                    ...r,
                    cid: r.cid,
                    content: {
                        ...r.content,
                        text: r.content?.text != null ? r.content?.text : null,
                        selfLabels: r.content?.selfLabels ?? [],
                        datasetsUsed: r.content?.datasetsUsed ?? [],
                        embeds: r.content?.embeds ?? null
                    }
                })
            }
        })

        const m = new Map<string, FeedElementQueryResult>(
            contents.map(c => [c.uri, c])
        )
        this.caContents = joinMaps(this.caContents, m)
    }

    async fetchTextBlobs(blobs: BlobRef[]) {
        const texts = await fetchTextBlobs(this.ctx, blobs)
        const keys = blobs.map(b => getBlobKey(b))

        const entries: [string, string | null][] = texts.map((t, i) => [keys[i], t])
        const m = removeNullValues(new Map<string, string | null>(entries))
        this.textBlobs = joinMaps(this.textBlobs, m)
    }

    async fetchPostAndArticleViewsHydrationData(uris: string[], otherDids: string[] = []) {
        const required = uris.flatMap(u => this.requires.get(u)).filter(x => x != null)
        uris = unique([...uris, ...required])
        const dids = unique([...uris.map(getDidFromUri), ...otherDids])

        await Promise.all([
            this.fetchBskyPosts(postUris(uris)),
            this.fetchCAContentsAndBlobs(uris),
            this.fetchEngagement(uris),
            this.fetchTopicsBasicByUris(topicVersionUris(uris)),
            this.fetchUsersHydrationData(dids)
        ])
    }

    async fetchTopicsBasicByUris(uris: string[]) {
        uris = uris.filter(u => !this.topicsByUri?.has(u))

        const data = await this.ctx.db.topicVersion.findMany({
            select: {
                uri: true,
                topic: {
                    select: {
                        id: true,
                        popularityScoreLastDay: true,
                        popularityScoreLastWeek: true,
                        popularityScoreLastMonth: true,
                        lastEdit: true,
                        categories: {
                            select: {
                                categoryId: true,
                            }
                        },
                        currentVersion: {
                            select: {
                                props: true,
                                synonyms: true,
                                categories: true
                            }
                        }
                    }
                }
            },
            where: {
                uri: {
                    in: uris
                }
            }
        })

        const queryResults: { uri: string, topic: TopicQueryResultBasic }[] = []

        data.forEach(item => {
            queryResults.push({
                uri: item.uri,
                topic: item.topic
            })
        })

        const mapByUri = new Map(queryResults.map(item => [item.uri, item.topic]))
        const mapById = new Map(queryResults.map(item => [item.topic.id, item.topic]))

        this.topicsByUri = joinMaps(this.topicsByUri, mapByUri)
        this.topicsById = joinMaps(this.topicsById, mapById)
    }

    async expandUrisWithRepliesAndReposts(skeleton: FeedSkeleton): Promise<string[]> {
        const uris = skeleton.map(e => e.post)
        const repostUris = skeleton
            .map(e => e.reason && isSkeletonReasonRepost(e.reason) ? e.reason.repost : null)
            .filter(x => x != null)

        const caPosts = (await Promise.all([
            this.fetchBskyPosts(postUris(uris)),
            this.ctx.db.post.findMany({
                select: {
                    uri: true,
                    replyToId: true,
                    rootId: true
                },
                where: {
                    uri: {
                        in: postUris(uris)
                    }
                }
            })
        ]))[1]

        const bskyPosts = uris.map(u => this.bskyPosts?.get(u)).filter(x => x != null)

        return unique([
            ...uris,
            ...repostUris,
            ...caPosts.map(p => p.replyToId),
            ...caPosts.map(p => p.rootId),
            ...bskyPosts.map(p => (p.record as PostRecord).reply?.root?.uri),
            ...bskyPosts.map(p => (p.record as PostRecord).reply?.parent?.uri),
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


    async fetchRootCreationDate(uris: string[]){
        uris = uris.filter(u => isPost(getCollectionFromUri(u)))
        if(uris.length == 0) return

        const rootCreationDates = await this.ctx.kysely
            .selectFrom("Post")
            .innerJoin("Record", "Record.uri", "Post.rootId")
            .select(["Post.uri", "Record.created_at"])
            .where("Post.uri", "in", uris)
            .execute()

        rootCreationDates.forEach(r => {
            this.rootCreationDates.set(r.uri, r.created_at)
        })
    }


    async fetchRepostsHydrationData(uris: string[]){
        uris = uris.filter(u => getCollectionFromUri(u) == "app.bsky.feed.repost")
        if(uris.length > 0){
            const reposts: RepostQueryResult[] = await this.ctx.db.record.findMany({
                select: {
                    uri: true,
                    createdAt: true,
                    reaction: {
                        select: {
                            subjectId: true
                        }
                    }
                },
                where: {
                    uri: {
                        in: uris
                    }
                }
            })
            reposts.forEach(r => {
                if(r.reaction?.subjectId){
                    this.reposts.set(r.reaction.subjectId, r)
                }
            })
        }
    }


    addEmbedsToPostsMap(m: Map<string, BskyPostView>) {
        const posts = Array.from(m.values())

        posts.forEach(post => {
            if (post.embed && post.embed.$type == "app.bsky.embed.record#view") {
                const embed = post.embed as AppBskyEmbedRecord.View
                if (embed.record.$type == "app.bsky.embed.record#viewRecord") {
                    const record = embed.record as ViewRecord
                    m.set(record.uri, {
                        ...record,
                        uri: record.uri,
                        cid: record.cid,
                        $type: "app.bsky.feed.defs#postView",
                        author: {
                            ...record.author
                        },
                        indexedAt: record.indexedAt,
                        record: record.value
                    })
                }
            }
        })

        return m
    }

    async fetchBskyPosts(uris: string[]) {
        uris = uris.filter(u => !this.bskyPosts?.has(u))
        const agent = this.agent
        if (!agent.hasSession()) return

        const postsList = postUris(uris)
        if (postsList.length == 0) return

        const batches: string[][] = []
        for (let i = 0; i < postsList.length; i += 25) {
            batches.push(postsList.slice(i, i + 25))
        }
        let postViews: PostView[]
        try {
            const results = await Promise.all(batches.map(b => agent.bsky.getPosts({uris: b})))
            postViews = results.map(r => r.data.posts).reduce((acc, cur) => [...acc, ...cur])
        } catch (err) {
            console.log("Error fetching posts", err)
            console.log("uris", uris)
            return
        }

        let m = new Map<string, BskyPostView>(
            postViews.map(item => [item.uri, item])
        )

        m = this.addEmbedsToPostsMap(m)

        this.bskyPosts = joinMaps(this.bskyPosts, m)
    }

    getFetchedBlob(blob: BlobRef): string | null {
        const key = getBlobKey(blob)
        return this.textBlobs?.get(key) ?? null
    }

    async fetchEngagement(uris: string[]) {
        const agent = this.agent
        if (!agent.hasSession()) return

        const did = agent.did
        const reactions = await this.ctx.db.reaction.findMany({
            select: {
                subjectId: true,
                uri: true
            },
            where: {
                record: {
                    authorId: did,
                    collection: {
                        in: ["app.bsky.feed.like", "app.bsky.feed.repost"]
                    }
                },
                subjectId: {
                    in: uris
                }
            }
        })

        reactions.forEach(l => {
            if (l.subjectId) {
                if (getCollectionFromUri(l.uri) == "app.bsky.feed.like") {
                    if (!this.likes.has(l.subjectId)) this.likes.set(l.subjectId, l.uri)
                }
                if (getCollectionFromUri(l.uri) == "app.bsky.feed.repost") {
                    if (!this.reposts.has(l.subjectId)) this.reposts.set(l.subjectId, {
                        uri: l.uri,
                        createdAt: null,
                        reaction: null
                    })
                }
            }
        })
    }

    async fetchThreadHydrationData(skeleton: ThreadSkeleton) {
        const uris = getUrisFromThreadSkeleton(skeleton)

        const c = getCollectionFromUri(skeleton.post)

        await Promise.all([
            this.fetchPostAndArticleViewsHydrationData(uris),
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
                    m.set(f.reply.parent.uri, f.reply.parent)
                }
                if (isPostView(f.reply.root)) {
                    m.set(f.reply.root.uri, f.reply.root)
                }
            }
            if (f.post.embed) {
                const embedUri = getUriFromEmbed(f.post.embed)
                if (embedUri) {
                    this.requires.set(f.post.uri, [...(this.requires.get(f.post.uri) ?? []), embedUri])
                }
            }
            if (f.reason) {
                if (isReasonRepost(f.reason) && f.post.uri) {
                    this.reposts.set(f.post.uri, {
                        createdAt: new Date(f.reason.indexedAt),
                        reaction: {
                            subjectId: f.post.uri
                        }
                    })
                }
            }
        })

        this.bskyPosts = joinMaps(this.bskyPosts, m)
    }

    async fetchDatasetsHydrationData(uris: string[]) {
        uris = uris.filter(u => !this.datasets?.has(u))
        if (uris.length == 0) return
        let datasets: DatasetQueryResult[] = await this.ctx.db.record.findMany({
            select: {
                ...recordQuery,
                dataset: {
                    select: {
                        title: true,
                        columns: true,
                        description: true,
                        dataBlocks: {
                            select: {
                                blob: {
                                    select: {
                                        cid: true,
                                        authorId: true
                                    }
                                },
                                format: true
                            }
                        }
                    }
                }
            },
            where: {
                uri: {
                    in: uris
                }
            }
        })
        this.datasets = joinMaps(this.datasets,
            new Map(datasets.map(d => [d.uri, d]))
        )
    }

    async fetchDatasetContents(uris: string[]) {
        uris = uris.filter(u => !this.datasetContents?.has(u))

        await this.fetchDatasetsHydrationData(uris)

        const blobs: { blobRef: BlobRef, datasetUri: string }[] = []

        for (let i = 0; i < uris.length; i++) {
            const uri = uris[i]
            const d = this.datasets?.get(uri)
            if (!d || !d.dataset) return

            const authorId = getDidFromUri(uri)
            const blocks = d.dataset.dataBlocks
            blobs.push(...blocks
                .map(b => b.blob)
                .filter(b => b != null)
                .filter(b => b.cid != null)
                .map(b => ({...b, authorId}))
                .map(b => ({blobRef: b, datasetUri: uri})))
        }

        const contents = (await fetchTextBlobs(this.ctx, blobs.map(b => b.blobRef))).filter(c => c != null)

        const datasetContents = new Map<string, string[]>()
        for (let i = 0; i < blobs.length; i++) {
            const uri = blobs[i].datasetUri
            const content = contents[i]
            if (!datasetContents.has(uri)) datasetContents.set(uri, [content])
            else datasetContents.set(uri, [...gett(datasetContents, uri), content])
        }

        this.datasetContents = joinMaps(this.datasetContents, datasetContents)
    }


    async fetchTopicsMentioned(uri: string) {
        const topics: TopicMentionedProps[] = await this.ctx.db.reference.findMany({
            select: {
                referencedTopic: {
                    select: {
                        id: true,
                        currentVersion: {
                            select: {
                                props: true
                            }
                        }
                    }
                },
                count: true
            },
            where: {
                referencingContentId: uri
            }
        })
        if (!this.topicsMentioned) this.topicsMentioned = new Map()
        this.topicsMentioned.set(uri, topics)
    }

    async fetchUsersHydrationDataFromCA(dids: string[]) {
        dids = dids.filter(d => !this.caUsers.has(d))
        if (dids.length == 0) return

        const data = await this.ctx.db.user.findMany({
            select: {
                did: true,
                CAProfileUri: true,
                displayName: true,
                handle: true,
                avatar: true,
                userValidationHash: true,
                orgValidation: true
            },
            where: {
                did: {
                    in: dids
                }
            }
        })

        const res: CAProfileViewBasic[] = []

        data.forEach(u => {
            if (u.handle != null) res.push({
                ...u,
                handle: u.handle,
                displayName: u.displayName ?? undefined,
                avatar: u.avatar ?? undefined,
                caProfile: u.CAProfileUri ?? undefined,
                verification: u.orgValidation ? "org" : (u.userValidationHash ? "person" : undefined)
            })
        })

        this.caUsers = joinMaps(
            this.caUsers,
            new Map(res.map(r => [r.did, r]))
        )
    }

    async fetchUsersHydrationDataFromBsky(dids: string[]) {
        const agent = this.agent
        if (!agent.hasSession()) return

        dids = dids.filter(d => !this.bskyUsers.has(d))
        if (dids.length == 0) return

        const didBatches: string[][] = []
        for (let i = 0; i < dids.length; i += 25) didBatches.push(dids.slice(i, i + 25))
        const data = await Promise.all(didBatches.map(b => agent.bsky.getProfiles({actors: b})))
        const profiles = data.flatMap(d => d.data.profiles)

        this.bskyUsers = joinMaps(
            this.bskyUsers,
            new Map(profiles.map(v => [v.did, {$type: "app.bsky.actor.defs#profileViewDetailed", ...v}]))
        )
    }

    async fetchUsersHydrationData(dids: string[]) {
        await Promise.all([
            this.fetchUsersHydrationDataFromCA(dids),
            this.fetchUsersHydrationDataFromBsky(dids)
        ])
    }

    async fetchFilesFromStorage(filePaths: string[], bucket: string) {
        for (let i = 0; i < filePaths.length; i++) {
            const path = filePaths[i]
            const {data} = await this.ctx.sb.storage
                .from(bucket)
                .download(path)

            if (data) {
                const buffer = await data.arrayBuffer();
                const base64 = Buffer.from(buffer).toString('base64');
                const mimeType = data.type;

                const fullBase64 = `data:${mimeType};base64,${base64}`;
                this.sbFiles.set(bucket + ":" + path, fullBase64);
            }
        }
    }


    async fetchNotificationsHydrationData(skeleton: NotificationsSkeleton) {
        if(!this.agent.hasSession() || skeleton.length == 0) return


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


    async fetchFilteredTopics(manyFilters: $Typed<ColumnFilter>[][]){
        const datasets = await Promise.all(manyFilters.map(async filters => {

            const includesFilters: {name: string, value: string}[] = []
            filters.forEach(f => {
                if(f.operator == "includes" && f.operands && f.operands.length > 0) {
                    includesFilters.push({name: f.column, value: f.operands[0]})
                }
            })
            return await this.ctx.kysely
                .selectFrom('Topic')
                .innerJoin('TopicVersion', 'TopicVersion.uri', 'Topic.currentVersionId')
                .select(['id', 'TopicVersion.props'])
                .where((eb) =>
                    eb.and(includesFilters.map(f => stringListIncludes(f.name, f.value)))
                )
                .execute() as {id: string, props: TopicProp[]}[]
        }))

        datasets.forEach((d, index) => {
            this.topicsDatasets.set(getObjectKey(manyFilters[index]), d)
        })
    }

    saveDataFromPostThread(thread: ThreadViewPost, includeParents: boolean, excludeChild?: string) {
        if(isPostView(thread.post)){
            this.bskyPosts.set(thread.post.uri, thread.post)
            this.bskyUsers.set(thread.post.author.did, {
                ...thread.post.author,
                $type: "app.bsky.actor.defs#profileViewBasic"
            })

            if(includeParents && thread.parent && isThreadViewPost(thread.parent)){
                this.saveDataFromPostThread(thread.parent, true, thread.post.uri)
            }

            if(thread.replies){
                thread.replies.forEach(r => {
                    if(isThreadViewPost(r) && isPostView(r.post)){
                        if(r.post.uri != excludeChild){
                            this.saveDataFromPostThread(r, true)
                        }
                    }
                })
            }
        }
    }
}