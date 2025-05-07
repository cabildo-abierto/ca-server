import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {PostView as BskyPostView} from "#/lex-server/types/app/bsky/feed/defs";
import {ProfileViewBasic} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {
    BlobRef, ThreadSkeleton
} from "#/services/hydration/hydrate";
import {FeedSkeleton} from "#/services/feed/feed";
import {removeNullValues, unique} from "#/utils/arrays";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post";
import {articleUris, getCollectionFromUri, getDidFromUri, isArticle, postUris, topicVersionUris} from "#/utils/uri";
import {AppBskyEmbedRecord} from "@atproto/api";
import {ViewRecord} from "@atproto/api/src/client/types/app/bsky/embed/record";
import {TopicQueryResultBasic} from "#/services/topic/topics";
import {authorQuery, logTimes, reactionsQuery, recordQuery} from "#/utils/utils";
import { FeedViewPost, isPostView, PostView } from "@atproto/api/dist/client/types/app/bsky/feed/defs";
import {fetchTextBlobs} from "#/services/blob";
import { Prisma } from "@prisma/client";




export type FeedElementQueryResult = {
    uri: string
    cid: string
    createdAt: Date | string,
    record: string | null
    author: {
        did: string
        handle: string | null
        displayName: string | null
        avatar: string | null
        CAProfileUri: string | null
    }
    _count: {
        likes: number
        reposts: number
        replies: number
    }
    uniqueViewsCount: number | null
    content: {
        text: string | null
        textBlobId?: string | null
        format?: string | null
        article?: {
            title: string
        } | null
        topicVersion?: {
            props: Prisma.JsonValue | null
            topicId: string
        } | null
    } | null
    enDiscusion: boolean | null
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
    }
    dataset: {
        title: string
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


export type HydrationData = {
    caContents?: Map<string, FeedElementQueryResult>
    bskyPosts?: Map<string, BskyPostView>
    likes?: Map<string, string | null>
    reposts?: Map<string, string | null>
    bskyUsers?: Map<string, ProfileViewBasic>
    caUsers?: Map<string, CAProfileViewBasic>
    topicsByUri?: Map<string, TopicQueryResultBasic>
    topicsById?: Map<string, TopicQueryResultBasic>
    textBlobs?: Map<string, string>
    datasets?: Map<string, DatasetQueryResult>
    datasetContents?: Map<string, string[]>
    topicsMentioned?: Map<string, TopicMentionedProps[]>
}


export function getBlobKey(blob: BlobRef) {
    return blob.cid + ":" + blob.authorId
}


export function blobRefsFromContents(contents: {
    content?: { textBlobId?: string | null } | null,
    author: { did: string }
}[]) {
    const blobRefs: { cid: string, authorId: string }[] = contents
        .map(a => (a.content?.textBlobId != null ? {cid: a.content.textBlobId, authorId: a.author.did} : null))
        .filter(x => x != null)

    return blobRefs
}


export class Dataplane {
    ctx: AppContext
    agent: SessionAgent
    data: HydrationData

    constructor(ctx: AppContext, agent: SessionAgent) {
        this.ctx = ctx
        this.agent = agent
        this.data = {}
    }

    async fetchCAContentsAndBlobs(uris: string[]) {
        const t1 = Date.now()
        await this.fetchCAContents(uris)

        const t2 = Date.now()
        const contents = Array.from(this.data.caContents?.values() ?? [])
        const blobRefs = blobRefsFromContents(contents)
        await this.fetchTextBlobs(blobRefs)
        const t3 = Date.now()
        logTimes("fetchCAContentsAndBlobs", [t1, t2, t3])
    }

    async fetchCAContents(uris: string[]) {
        uris = uris.filter(u => !this.data.caContents?.has(u))
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
                    ...authorQuery,
                    ...reactionsQuery,
                    record: true,
                    enDiscusion: true,
                    content: {
                        select: {
                            text: true
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
                    ...authorQuery,
                    ...reactionsQuery,
                    record: true,
                    enDiscusion: true,
                    content: {
                        select: {
                            text: true,
                            format: true,
                            textBlobId: true,
                            article: {
                                select: {
                                    title: true
                                }
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
                    ...authorQuery,
                    ...reactionsQuery,
                    record: true,
                    enDiscusion: true,
                    content: {
                        select: {
                            text: true,
                            format: true,
                            textBlobId: true,
                            topicVersion: {
                                select: {
                                    props: true,
                                    topicId: true
                                }
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
            if (r.cid && r.author.handle) {
                contents.push({
                    ...r,
                    cid: r.cid,
                    author: {
                        ...r.author,
                        handle: r.author.handle
                    }
                })
            }
        })

        const m = new Map<string, FeedElementQueryResult>(
            contents.map(c => [c.uri, c])
        )
        this.data.caContents = joinMaps(this.data.caContents, m)
    }

    async fetchTextBlobs(blobs: BlobRef[]) {
        const texts = await fetchTextBlobs(this.ctx, blobs)
        const keys = blobs.map(b => getBlobKey(b))

        const entries: [string, string | null][] = texts.map((t, i) => [keys[i], t])
        const m = removeNullValues(new Map<string, string | null>(entries))
        this.data.textBlobs = joinMaps(this.data.textBlobs, m)
    }

    async fetchPostAndArticleViewsHydrationData(uris: string[]) {
        await Promise.all([
            this.fetchBskyPosts(postUris(uris)),
            this.fetchCAContentsAndBlobs(uris),
            this.fetchEngagement(uris),
            this.fetchTopicsBasicByUris(topicVersionUris(uris))
        ])
    }

    async fetchTopicsBasicByUris(uris: string[]) {
        uris = uris.filter(u => !this.data.topicsByUri?.has(u))

        const t1 = Date.now()

        const data = await this.ctx.db.topicVersion.findMany({
            select: {
                uri: true,
                topic: {
                    select: {
                        id: true,
                        popularityScore: true,
                        lastEdit: true,
                        categories: {
                            select: {
                                categoryId: true,
                            }
                        },
                        synonyms: true,
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

        const t2 = Date.now()
        logTimes("fetchTopicsBasicByUris", [t1, t2])
        const queryResults: { uri: string, topic: TopicQueryResultBasic }[] = []

        data.forEach(item => {
            queryResults.push({
                uri: item.uri,
                topic: item.topic
            })
        })

        const mapByUri = new Map(queryResults.map(item => [item.uri, item.topic]))
        const mapById = new Map(queryResults.map(item => [item.topic.id, item.topic]))

        this.data.topicsByUri = joinMaps(this.data.topicsByUri, mapByUri)
        this.data.topicsById = joinMaps(this.data.topicsById, mapById)
    }

    async fetchTopicsBasicByIds(ids: string[]) {
        ids = ids.filter(u => !this.data.topicsById?.has(u))

        const data: TopicQueryResultBasic[] = await this.ctx.db.topic.findMany({
            select: {
                id: true,
                popularityScore: true,
                lastEdit: true,
                categories: {
                    select: {
                        categoryId: true,
                    }
                },
                synonyms: true,
                currentVersion: {
                    select: {
                        props: true,
                        synonyms: true,
                        categories: true
                    }
                }
            },
            where: {
                id: {
                    in: ids
                }
            }
        })

        const mapById = new Map(data.map(item => [item.id, item]))
        this.data.topicsById = joinMaps(this.data.topicsById, mapById)
    }

    async expandUrisWithReplies(uris: string[]): Promise<string[]> {
        const [_, caPosts] = await Promise.all([
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
        ])

        const bskyPosts = uris.map(u => this.data.bskyPosts?.get(u)).filter(x => x != null)

        return unique([
            ...uris,
            ...caPosts.map(p => p.replyToId),
            ...caPosts.map(p => p.rootId),
            ...bskyPosts.map(p => (p.record as PostRecord).reply?.root?.uri),
            ...bskyPosts.map(p => (p.record as PostRecord).reply?.parent?.uri),
            // faltan quote posts
        ].filter(x => x != null))
    }

    async fetchFeedHydrationData(skeleton: FeedSkeleton) {
        const uris = skeleton.map(p => p.post)
        const t1 = Date.now()
        const urisWithReplies = await this.expandUrisWithReplies(uris)
        const t2 = Date.now()
        await this.fetchPostAndArticleViewsHydrationData(urisWithReplies)
        const t3 = Date.now()
        logTimes("fetchFeedHydrationData", [t1, t2, t3])
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
        uris = uris.filter(u => !this.data.bskyPosts?.has(u))

        const postsList = postUris(uris)
        if (postsList.length == 0) return

        const batches: string[][] = []
        for (let i = 0; i < postsList.length; i += 25) {
            batches.push(postsList.slice(i, i + 25))
        }
        let postViews: PostView[]
        try {
            const results = await Promise.all(batches.map(b => this.agent.bsky.getPosts({uris: b})))
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

        this.data.bskyPosts = joinMaps(this.data.bskyPosts, m)
    }

    getFetchedBlob(blob: BlobRef): string | null {
        const key = getBlobKey(blob)
        return this.data.textBlobs?.get(key) ?? null
    }

    async fetchEngagement(uris: string[]) {
        const t1 = Date.now()
        const did = this.agent.did
        const getLikes = this.ctx.db.like.findMany({
            select: {
                likedRecordId: true,
                uri: true
            },
            where: {
                record: {
                    authorId: did
                },
                likedRecordId: {
                    in: uris
                }
            }
        })

        const getReposts = this.ctx.db.repost.findMany({
            select: {
                repostedRecordId: true,
                uri: true
            },
            where: {
                record: {
                    authorId: did
                },
                repostedRecordId: {
                    in: uris
                }
            }
        })

        const [likes, reposts] = await Promise.all([getLikes, getReposts])

        const likesMap = new Map<string, string | null>(uris.map(uri => [uri, null]))
        const repostsMap = new Map<string, string | null>(uris.map(uri => [uri, null]))

        likes.forEach(l => {
            if (l.likedRecordId) {
                likesMap.set(l.likedRecordId, l.uri)
            }
        })

        reposts.forEach(l => {
            if (l.repostedRecordId) {
                repostsMap.set(l.repostedRecordId, l.uri)
            }
        })

        this.data.likes = joinMaps(this.data.likes, likesMap)
        this.data.reposts = joinMaps(this.data.reposts, repostsMap)
        const t2 = Date.now()
        logTimes("fetchEngagement", [t1, t2])
    }

    async fetchThreadHydrationData(skeleton: ThreadSkeleton) {
        const expanded = await this.expandUrisWithReplies([skeleton.post])
        const c = getCollectionFromUri(skeleton.post)

        const uris = [
            ...(skeleton.replies ? skeleton.replies.map(({post}) => post) : []),
            ...expanded
        ]

        await Promise.all([
            this.fetchPostAndArticleViewsHydrationData(uris),
            isArticle(c) ? this.fetchTopicsMentioned(skeleton.post) : null
        ])
    }

    storeFeedViewPosts(feed: FeedViewPost[]){
        const m = new Map<string, PostView>()
        feed.forEach(f => {
            m.set(f.post.uri, f.post)
            if(f.reply){
                if(isPostView(f.reply.parent)){
                    m.set(f.reply.parent.uri, f.reply.parent)
                }
                if(isPostView(f.reply.root)){
                    m.set(f.reply.root.uri, f.reply.root)
                }
            }
        })

        this.data.bskyPosts = joinMaps(this.data.bskyPosts, m)
    }

    async fetchDatasetsHydrationData(uris: string[]) {
        uris = uris.filter(u => !this.data.datasets?.has(u))
        if(uris.length == 0) return
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
        this.data.datasets = joinMaps(this.data.datasets,
            new Map(datasets.map(d => [d.uri, d]))
        )
    }

    async fetchDatasetContents(uri: string){
        if(this.data.datasetContents?.has(uri)) return

        await this.fetchDatasetsHydrationData([uri])

        const d = this.data.datasets?.get(uri)
        if(!d || !d.dataset) return

        const authorId = getDidFromUri(uri)
        const blocks = d.dataset.dataBlocks
        const blobs: BlobRef[] = blocks
            .map(b => b.blob)
            .filter(b => b != null)
            .filter(b => b.cid != null)
            .map(b => ({...b, authorId}))

        const contents = (await fetchTextBlobs(this.ctx, blobs)).filter(c => c != null)

        if(!this.data.datasetContents) this.data.datasetContents = new Map()
        this.data.datasetContents.set(uri, contents)
    }


    async fetchTopicsMentioned(uri: string){
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
        if(!this.data.topicsMentioned) this.data.topicsMentioned = new Map()
        this.data.topicsMentioned.set(uri, topics)
    }
}