import {AppContext} from "#/index";
import {Agent} from "#/utils/session-agent";
import {PostView as BskyPostView} from "#/lex-server/types/app/bsky/feed/defs";
import {ProfileViewBasic} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {
    BlobRef, ThreadSkeleton
} from "#/services/hydration/hydrate";
import {FeedSkeleton} from "#/services/feed/feed";
import {gett, removeNullValues, unique} from "#/utils/arrays";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post";
import {articleUris, getCollectionFromUri, getDidFromUri, isArticle, postUris, topicVersionUris} from "#/utils/uri";
import {AppBskyEmbedRecord} from "@atproto/api";
import {ViewRecord} from "@atproto/api/src/client/types/app/bsky/embed/record";
import {TopicQueryResultBasic} from "#/services/wiki/topics";
import {authorQuery, reactionsQuery, recordQuery} from "#/utils/utils";
import {FeedViewPost, isPostView, PostView} from "@atproto/api/dist/client/types/app/bsky/feed/defs";
import {fetchTextBlobs} from "#/services/blob";
import {Prisma} from "@prisma/client";
import {env} from "#/lib/env";
import { AtpBaseClient } from "#/lex-api";


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
        datasetsUsed: {uri: string}[]
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
    agent: Agent
    caContents: Map<string, FeedElementQueryResult>
    bskyPosts: Map<string, BskyPostView>
    likes: Map<string, string | null>
    reposts: Map<string, string | null>
    bskyUsers: Map<string, ProfileViewBasic>
    caUsers: Map<string, CAProfileViewBasic>
    topicsByUri: Map<string, TopicQueryResultBasic>
    topicsById: Map<string, TopicQueryResultBasic>
    textBlobs: Map<string, string>
    datasets: Map<string, DatasetQueryResult>
    datasetContents: Map<string, string[]>
    topicsMentioned: Map<string, TopicMentionedProps[]>
    sbFiles: Map<string, string>

    constructor(ctx: AppContext, agent?: Agent) {
        this.ctx = ctx
        this.agent = agent ?? new Agent(new AtpBaseClient(`${env.HOST}:${env.PORT}`))
        this.caContents = new Map()
        this.bskyPosts = new Map()
        this.likes = new Map()
        this.reposts = new Map()
        this.bskyUsers = new Map()
        this.caUsers = new Map()
        this.topicsByUri = new Map()
        this.topicsById = new Map()
        this.textBlobs = new Map()
        this.datasets = new Map()
        this.datasetContents = new Map()
        this.topicsMentioned = new Map()
        this.sbFiles = new Map()
    }

    async fetchCAContentsAndBlobs(uris: string[]) {
        await this.fetchCAContents(uris)

        const contents = Array.from(this.caContents?.values() ?? [])
        const blobRefs = blobRefsFromContents(contents)

        const datasets = contents.reduce((acc, cur) => {
            return [...acc, ...cur.content?.datasetsUsed.map(d => d.uri) ?? []]
        }, [] as string[])

        await this.fetchDatasetsHydrationData(datasets)

        await this.fetchDatasetContents(datasets)

        await this.fetchTextBlobs(blobRefs)
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
                    ...authorQuery,
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
                    ...authorQuery,
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
                    ...authorQuery,
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
            if (r.cid && r.author.handle) {
                contents.push({
                    ...r,
                    cid: r.cid,
                    author: {
                        ...r.author,
                        handle: r.author.handle
                    },
                    content: {
                        ...r.content,
                        text: r.content?.text ?? null,
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

    async fetchPostAndArticleViewsHydrationData(uris: string[]) {
        await Promise.all([
            this.fetchBskyPosts(postUris(uris)),
            this.fetchCAContentsAndBlobs(uris),
            this.fetchEngagement(uris),
            this.fetchTopicsBasicByUris(topicVersionUris(uris))
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

    async fetchTopicsBasicByIds(ids: string[]) {
        ids = ids.filter(u => !this.topicsById?.has(u))

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
        this.topicsById = joinMaps(this.topicsById, mapById)
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

        const bskyPosts = uris.map(u => this.bskyPosts?.get(u)).filter(x => x != null)

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
        const urisWithReplies = await this.expandUrisWithReplies(uris)
        await this.fetchPostAndArticleViewsHydrationData(urisWithReplies)
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
        if(!agent.hasSession()) return

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
        if(!agent.hasSession()) return

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
                }
            }
        })

        const likesMap = new Map<string, string | null>(uris.map(uri => [uri, null]))
        const repostsMap = new Map<string, string | null>(uris.map(uri => [uri, null]))

        reactions.forEach(l => {
            if (l.subjectId) {
                if (getCollectionFromUri(l.uri) == "app.bsky.feed.like") {
                    likesMap.set(l.subjectId, l.uri)
                }
                if (getCollectionFromUri(l.uri) == "app.bsky.feed.repost") {
                    repostsMap.set(l.subjectId, l.uri)
                }
            }
        })

        this.likes = joinMaps(this.likes, likesMap)
        this.reposts = joinMaps(this.reposts, repostsMap)
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

        const blobs: {blobRef: BlobRef, datasetUri: string}[] = []

        for(let i = 0; i < uris.length; i ++) {
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
        for(let i = 0; i < blobs.length; i ++) {
            const uri = blobs[i].datasetUri
            const content = contents[i]
            if(!datasetContents.has(uri)) datasetContents.set(uri, [content])
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
                avatar: true
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
                caProfile: u.CAProfileUri ?? undefined
            })
        })

        this.caUsers = joinMaps(
            this.caUsers,
            new Map(res.map(r => [r.did, r]))
        )
    }

    async fetchUsersHydrationDataFromBsky(dids: string[]) {
        const agent = this.agent
        if(!agent.hasSession()) return

        dids = dids.filter(d => !this.bskyUsers.has(d))
        if (dids.length == 0) return

        const {data} = await agent.bsky.getProfiles({actors: dids})

        const views: ProfileViewBasic[] = data.profiles.map(p => ({
            ...p,
            $type: "app.bsky.actor.defs#profileViewBasic"
        }))

        this.bskyUsers = joinMaps(
            this.bskyUsers,
            new Map(views.map(v => [v.did, v]))
        )
    }

    async fetchUsersHydrationData(dids: string[]) {
        await Promise.all([
            this.fetchUsersHydrationDataFromCA(dids),
            this.fetchUsersHydrationDataFromBsky(dids)
        ])
    }

    async fetchFilesFromStorage(filePaths: string[], bucket: string) {
        for(let i = 0; i < filePaths.length; i ++) {
            const path = filePaths[i]
            const { data, error } = await this.ctx.sb.storage
                .from(bucket)
                .download(path)

            if(data){
                const buffer = await data.arrayBuffer();
                const base64 = Buffer.from(buffer).toString('base64');
                const mimeType = data.type;

                const fullBase64 = `data:${mimeType};base64,${base64}`;
                this.sbFiles.set(bucket + ":" + path, fullBase64);
            }
        }
    }
}