import {$Typed, AppBskyEmbedRecord} from "@atproto/api";
import {ViewRecord} from "@atproto/api/src/client/types/app/bsky/embed/record";
import {Collection, FeedEngagementProps} from "#/lib/types";
import {logTimes, reactionsQuery, recordQuery} from "#/utils/utils";
import {
    ArticleView,
    FeedViewContent,
    FullArticleView,
    isFeedViewContent,
    PostView, ThreadViewContent
} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {ProfileViewBasic} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {getCollectionFromUri, isArticle} from "#/utils/uri";
import {PostView as BskyPostView, SkeletonFeedPost} from "#/lex-api/types/app/bsky/feed/defs";
import {FeedSkeleton} from "#/services/feed/feed";
import {getUserEngagement} from "#/services/feed/get-user-engagement";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {getTextFromBlob} from "#/services/topic/topics";
import {decompress} from "#/utils/compression";
import {getAllText} from "#/services/topic/diff";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post"
import {isNotFoundPost, isReasonRepost, NotFoundPost} from "#/lex-server/types/app/bsky/feed/defs";
import {gett, listOrderDesc, sortByKey} from "#/utils/arrays";
import {isMain as isRecordEmbed} from "#/lex-server/types/app/bsky/embed/record"
import {isMain as isRecordWithMediaEmbed} from "#/lex-server/types/app/bsky/embed/recordWithMedia"
import {isMain as isSelectionQuoteEmbed, View as SelectionQuoteEmbedView, Main as SelectionQuoteEmbed} from "#/lex-server/types/ar/cabildoabierto/embed/selectionQuote"
import {creationDateSortKey} from "#/services/feed/utils";


type FeedElementQueryResult = {
    uri: string
    cid: string
    rkey: string
    collection: Collection
    createdAt: Date,
    record: string | null
    author: {
        did: string
        handle: string
        displayName: string | null
        avatar: string | null
    }
    _count: {
        likes: number
        reposts: number
        replies: number
    }
    uniqueViewsCount: number | null
    content: {
        text: string | null
        summary?: string
        textBlob: {
            cid: string
        } | null
        format: string | null
        post: {
            quote: string | null
            embed: string | null
            facets: string | null
            replyTo: {
                uri: string
                cid: string | null
                author: {
                    did: string
                    handle: string | null
                    displayName: string | null
                }
            } | null
            root: {
                uri: string
                cid: string | null
                author: {
                    did: string
                    handle: string | null
                    displayName: string | null
                }
            } | null
        } | null,
        article: {
            title: string
        } | null
    } | null
    enDiscusion: boolean | null
}


const hydrateFeedQuery = {
    ...recordQuery,
    ...reactionsQuery,
    record: true,
    enDiscusion: true,
    content: {
        select: {
            text: true,
            format: true,
            textBlob: true,
            article: {
                select: {
                    title: true
                }
            },
            post: {
                select: {
                    facets: true,
                    embed: true,
                    quote: true,
                    replyTo: {
                        select: {
                            uri: true,
                            cid: true,
                            author: {
                                select: {
                                    did: true,
                                    handle: true,
                                    displayName: true
                                }
                            }
                        }
                    },
                    root: {
                        select: {
                            uri: true,
                            cid: true,
                            author: {
                                select: {
                                    did: true,
                                    handle: true,
                                    displayName: true
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}


const queryResultToProfileViewBasic = (e: FeedElementQueryResult): ProfileViewBasic => {
    return {
        $type: "app.bsky.actor.defs#profileViewBasic",
        did: e.author.did,
        handle: e.author.handle,
        displayName: e.author.displayName ?? undefined,
        avatar: e.author.avatar ?? undefined,
    }
}


export function hydrateViewer(uri: string, data: HydrationData) {
    if(!data.engagement) return {}

    let like: string | undefined
    let repost: string | undefined

    data.engagement.likes.forEach(l => {
        if (l.likedRecordId == uri) {
            like = l.uri
        }
    })
    data.engagement.reposts.forEach(l => {
        if (l.repostedRecordId == uri) {
            repost = l.uri
        }
    })

    return {repost, like}
}


export function hydrateFullArticleView(uri: string, data: HydrationData): {
    data?: $Typed<FullArticleView>
    error?: string
} {
    const e = data.caContents?.get(uri)
    if (!e) return {error: "Ocurrió un error al cargar el contenido."}

    const viewer = hydrateViewer(e.uri, data)

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#fullArticleView",
            uri: e.uri,
            cid: e.cid,
            text: e.content && e.content.text ? e.content.text : undefined,
            textFormat: e.content?.format ?? undefined,
            author: queryResultToProfileViewBasic(e),
            record: e.record ? JSON.parse(e.record) : {},
            indexedAt: e.createdAt.toISOString(),
            likeCount: e._count.likes,
            repostCount: e._count.reposts,
            replyCount: e._count.replies,
            uniqueViewsCount: e.uniqueViewsCount ?? undefined,
            viewer
        }
    }
}


export function hydrateArticleView(uri: string, data: HydrationData): {
    data?: $Typed<ArticleView>
    error?: string
} {
    const e = data.caContents?.get(uri)
    if (!e) return {error: "Ocurrió un error al cargar el contenido."}

    const viewer = hydrateViewer(e.uri, data)

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#articleView",
            uri: e.uri,
            cid: e.cid,
            summary: e.content && e.content.summary ? e.content.summary : undefined,
            author: queryResultToProfileViewBasic(e),
            record: e.record ? JSON.parse(e.record) : {},
            indexedAt: e.createdAt.toISOString(),
            likeCount: e._count.likes,
            repostCount: e._count.reposts,
            replyCount: e._count.replies,
            uniqueViewsCount: e.uniqueViewsCount ?? undefined,
            viewer
        }
    }
}


function feedElementQueryResultToProfileViewBasic(e: FeedElementQueryResult) : ProfileViewBasic {
    return {
        did: e.author.did,
        handle: e.author.handle,
        displayName: e.author.displayName ?? undefined,
        avatar: e.author.avatar ?? undefined
    }
}


function hydrateSelectionQuoteEmbedView(embed: SelectionQuoteEmbed, quotedContent: string, data: HydrationData): $Typed<SelectionQuoteEmbedView> | null {
    const caData = data.caContents?.get(quotedContent)

    if(!caData || !caData.content || !caData.content.text) {
        return null
    }

    return {
        $type: "ar.cabildoabierto.embed.selectionQuote#view",
        start: embed.start,
        end: embed.end,
        quotedText: caData.content.text,
        quotedTextFormat: caData.content.format ?? undefined,
        quotedContentTitle: caData.content.article?.title,
        quotedContent,
        quotedContentAuthor: feedElementQueryResultToProfileViewBasic(caData)
    }
}


function hydratePostView(uri: string, data: HydrationData): { data?: $Typed<PostView>, error?: string } {
    const post = data.bskyPosts?.get(uri)
    const caData = data.caContents?.get(uri)

    if (!post) {
        return {error: "Ocurrió un error al cargar el contenido."}
    }

    const record = post.record as PostRecord
    const embed = record.embed

    let embedView: PostView["embed"] = post.embed
    if(isSelectionQuoteEmbed(embed) && record.reply){
        const view = hydrateSelectionQuoteEmbedView(embed, record.reply.parent.uri, data)
        if(view) embedView = view
    }

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#postView",
            ...post,
            embed: embedView,
            ...(caData ? {
                uniqueViewsCount: caData.uniqueViewsCount ?? undefined,
                likeCount: caData._count.likes,
                repostCount: caData._count.reposts,
            } : {
                uniqueViewsCount: 0,
                likeCount: 0,
                repostCount: 0
            }),
            bskyLikeCount: post.likeCount,
            bskyRepostCount: post.repostCount,
            bskyQuoteCount: post.quoteCount,
            replyCount: post.replyCount
        }
    }
}


export function hydrateContent(uri: string, data: HydrationData, full: boolean=false): {
    data?: $Typed<PostView> | $Typed<ArticleView> | $Typed<FullArticleView>,
    error?: string
} {
    const collection = getCollectionFromUri(uri)
    if (collection == "app.bsky.feed.post") {
        return hydratePostView(uri, data)
    } else if (collection == "ar.cabildoabierto.feed.article") {
        return full ? hydrateFullArticleView(uri, data) : hydrateArticleView(uri, data)
    } else {
        return {error: "Hidratación no implementada para: " + collection}
    }
}


export function notFoundPost(uri: string): $Typed<NotFoundPost> {
    return {
        $type: "app.bsky.feed.defs#notFoundPost",
        uri,
        notFound: true
    }
}


function hydrateFeedViewContent(e: SkeletonFeedPost, data: HydrationData): $Typed<FeedViewContent> | $Typed<NotFoundPost> {
    const reason = e.reason

    const childBsky = data.bskyPosts?.get(e.post)
    const reply = childBsky ? (childBsky.record as PostRecord).reply : null

    const leaf = hydrateContent(e.post, data)
    const parent = reply && !isReasonRepost(reason) ? hydrateContent(reply.parent.uri, data) : null
    const root = reply && !isReasonRepost(reason) ? hydrateContent(reply.root.uri, data) : null

    if (!leaf.data || leaf.error) {
        return notFoundPost(e.post)
    } else if (!reply) {
        return {
            $type: "ar.cabildoabierto.feed.defs#feedViewContent",
            content: leaf.data,
            reason
        }
    } else {
        return {
            $type: "ar.cabildoabierto.feed.defs#feedViewContent",
            content: leaf.data,
            reason,
            reply: {
                parent: parent && parent.data ? parent.data : notFoundPost(reply.parent.uri),
                root: root && root.data ? root.data : notFoundPost(reply.root.uri) // puede ser igual a parent, el frontend se ocupa
            }
        }
    }
}


export const bskyPostViewToCAPostView = (p: BskyPostView): PostView => {
    return {
        ...p,
        $type: "ar.cabildoabierto.feed.defs#postView",
    }
}


export async function getBskyPosts(agent: SessionAgent, uris: string[]): Promise<Map<string, PostView>> {
    const postsList = uris.filter(uri => (getCollectionFromUri(uri) == "app.bsky.feed.post"))

    if (postsList.length == 0) {
        return new Map()
    } else {
        const batches: string[][] = []
        for (let i = 0; i < postsList.length; i += 25) {
            batches.push(postsList.slice(i, i + 25))
        }
        const results = await Promise.all(batches.map(b => agent.bsky.getPosts({uris: b})))
        const postViews = results.map(r => r.data.posts).reduce((acc, cur) => [...acc, ...cur]).map(bskyPostViewToCAPostView)

        let m = new Map<string, PostView>(
            postViews.map(item => [item.uri, item])
        )

        m = addEmbedsToPostsMap(m)

        return m
    }
}


export async function getCAFeedContents(ctx: AppContext, uris: string[]): Promise<Map<string, FeedElementQueryResult>> {
    const t1 = Date.now()
    const res = await ctx.db.record.findMany({
        select: {
            ...hydrateFeedQuery,
        },
        where: {
            uri: {
                in: uris
            }
        }
    })
    const t2 = Date.now()

    let contents: FeedElementQueryResult[] = []
    res.forEach(r => {
        if (r.cid && r.author.handle) {
            contents.push({
                ...r,
                cid: r.cid,
                author: {
                    ...r.author,
                    handle: r.author.handle
                },
                collection: r.collection as Collection,
            })
        }
    })

    const m = new Map<string, FeedElementQueryResult>(
        contents.map(item => [item.uri, item])
    )

    await fetchArticleBlobs(m)
    const t3 = Date.now()

    logTimes("get feed ca contents", [t1, t2, t3])

    return m
}


function addEmbedsToPostsMap(m: Map<string, PostView>) {
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
                    $type: "ar.cabildoabierto.feed.defs#postView",
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


function markdownToPlainText(md: string) {
    return md // TO DO: Transformar a editor state y luego a plain text
}


const fetchArticleBlob = async (val: FeedElementQueryResult) => {
    if(!val.content || !val.content.textBlob) return null
    const blob = val.content.textBlob
    return await getTextFromBlob({cid: blob.cid, authorId: val.author.did})
}


const fetchArticleBlobs = async (m: Map<string, FeedElementQueryResult>) => {
    const keys = Array.from(m.keys())

    const articles: FeedElementQueryResult[] = keys.filter((k) => {
        const val = m.get(k)
        return val && isArticle(val.collection) && val.content && val.content.textBlob
    }).map(k => gett(m, k))

    const texts = await Promise.all(articles.map(fetchArticleBlob))

    for(let i = 0; i < texts.length; i++){
        const text = texts[i]
        if(!text) continue
        const val = articles[i]
        if(!val.content) continue

        const format = val.content.format
        let summary = ""
        if (format == "markdown") {
            summary = markdownToPlainText(text).slice(0, 150)
        } else if (!format || format == "lexical-compressed") {
            const summaryJson = JSON.parse(decompress(text))
            summary = getAllText(summaryJson.root).slice(0, 150)
        }
        val.content.summary = summary
        val.content.text = text
    }
}


function getReplyUrisFromPostViews(postViews: PostView[]) {
    return postViews.reduce((acc: string[], cur) => {
        const record = cur.record as PostRecord
        if (record.reply) {
            return [...acc, cur.uri, record.reply.root.uri, record.reply.parent.uri]
        } else {
            return [...acc, cur.uri]
        }
    }, [])
}


export async function fetchHydrationData(ctx: AppContext, agent: SessionAgent, skeleton: FeedSkeleton): Promise<HydrationData> {
    const uris = skeleton.map(p => p.post)

    const t1 = Date.now()
    const bskyPostsMap = await getBskyPosts(agent, uris)

    const replyUris = getReplyUrisFromPostViews(Array.from(bskyPostsMap.values()))

    const t2 = Date.now()
    const [bskyRepliesMap, caContents, engagement] = await Promise.all([
        getBskyPosts(agent, replyUris),
        getCAFeedContents(ctx, uris),
        getUserEngagement(ctx, uris, agent.did)
    ])

    const t3 = Date.now()
    let bskyMap = new Map([...bskyPostsMap, ...bskyRepliesMap])

    logTimes("fetch feed data", [t1, t2, t3])
    return {
        caContents,
        bskyPosts: bskyMap,
        engagement
    }
}


export type HydrationData = {
    caContents?: Map<string, FeedElementQueryResult>
    bskyPosts?: Map<string, PostView>
    engagement?: FeedEngagementProps
}


export function joinHydrationData(a: HydrationData, b: HydrationData): HydrationData{
    return {
        caContents: new Map([...a.caContents ?? [], ...b.caContents ?? []]),
        bskyPosts: new Map([...a.bskyPosts ?? [], ...b.bskyPosts ?? []]),
        engagement: {
            likes: [...a.engagement?.likes ?? [], ...b.engagement?.likes ?? []],
            reposts: [...b.engagement?.reposts ?? [], ...b.engagement?.reposts ?? []]
        }
    }
}


export async function hydrateFeed(ctx: AppContext, agent: SessionAgent, skeleton: FeedSkeleton): Promise<$Typed<FeedViewContent>[]> {
    const data = await fetchHydrationData(ctx, agent, skeleton)

    const feed = skeleton
        .map((e) => (hydrateFeedViewContent(e, data)))

    feed.filter(isNotFoundPost).forEach(x => {
        console.log("Post not found:", x.uri)
    })

    return feed.filter(x => isFeedViewContent(x))
}


export type ThreadSkeleton = {
    post: string
    replies?: {post: string}[]
}


export function hydrateThreadViewContent(skeleton: ThreadSkeleton, data: HydrationData, includeReplies: boolean=false): $Typed<ThreadViewContent> | null {
    const content = hydrateContent(skeleton.post, data, true).data
    if(!content) return null

    let replies: $Typed<ThreadViewContent>[] | undefined
    if(includeReplies && skeleton.replies){
        replies = skeleton.replies
            .map((r) => (hydrateThreadViewContent(r, data, false)))
            .filter(x => x != null)

        replies = sortByKey(replies, creationDateSortKey, listOrderDesc)
    }

    return {
        $type: "ar.cabildoabierto.feed.defs#threadViewContent",
        content,
        replies
    }
}