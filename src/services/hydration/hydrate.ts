import {$Typed, AppBskyEmbedRecord} from "@atproto/api";
import {ViewRecord} from "@atproto/api/src/client/types/app/bsky/embed/record";
import {Collection} from "#/lib/types";
import {authorQuery, reactionsQuery, recordQuery} from "#/utils/utils";
import {
    ArticleView,
    FeedViewContent,
    FullArticleView,
    isFeedViewContent,
    PostView,
    ThreadViewContent
} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs"
import {articleCollections, getCollectionFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri";
import {
    isNotFoundPost,
    isReasonRepost,
    NotFoundPost,
    PostView as BskyPostView,
    SkeletonFeedPost
} from "#/lex-server/types/app/bsky/feed/defs";
import {FeedSkeleton} from "#/services/feed/feed";
import {getUserEngagement} from "#/services/feed/get-user-engagement";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {getTextFromBlob, getTopicVersion} from "#/services/topic/topics";
import {decompress} from "#/utils/compression";
import {getAllText} from "#/services/topic/diff";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post"
import {gett, listOrderDesc, range, sortByKey, unique} from "#/utils/arrays";
import {
    isMain as isSelectionQuoteEmbed,
    Main as SelectionQuoteEmbed,
    View as SelectionQuoteEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/selectionQuote"
import {creationDateSortKey} from "#/services/feed/utils";
import {TopicView} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicTitle} from "#/services/topic/utils";
import {markdownToPlainText} from "#/utils/lexical/transforms";
import {Dataplane, FeedElementQueryResult} from "#/services/hydration/dataplane";


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


const queryResultToProfileViewBasic = (e: FeedElementQueryResult["author"]): CAProfileViewBasic | null => {
    if(!e.handle) return null
    return {
        $type: "ar.cabildoabierto.actor.defs#profileViewBasic",
        did: e.did,
        handle: e.handle,
        displayName: e.displayName ?? undefined,
        avatar: e.avatar ?? undefined,
        caProfile: e.CAProfileUri ?? undefined
    }
}


export function hydrateViewer(uri: string, data: Dataplane) {
    if (!data.data.engagement) return {}

    let like: string | undefined
    let repost: string | undefined

    data.data.engagement.likes.forEach(l => {
        if (l.likedRecordId == uri) {
            like = l.uri
        }
    })
    data.data.engagement.reposts.forEach(l => {
        if (l.repostedRecordId == uri) {
            repost = l.uri
        }
    })

    return {repost, like}
}


export function hydrateFullArticleView(uri: string, data: Dataplane): {
    data?: $Typed<FullArticleView>
    error?: string
} {
    const e = data.data.caContents?.get(uri)
    if (!e) return {error: "Ocurrió un error al cargar el contenido."}

    const viewer = hydrateViewer(e.uri, data)
    const author = queryResultToProfileViewBasic(e.author)
    if(!author) return {error: "Ocurrió un error al cargar el contenido."}

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#fullArticleView",
            uri: e.uri,
            cid: e.cid,
            text: e.content && e.content.text ? e.content.text : undefined,
            format: e.content?.format ?? undefined,
            author,
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


export function hydrateArticleView(uri: string, data: Dataplane): {
    data?: $Typed<ArticleView>
    error?: string
} {
    const e = data.data.caContents?.get(uri)
    if (!e) return {error: "Ocurrió un error al cargar el contenido."}

    const viewer = hydrateViewer(e.uri, data)
    const author = queryResultToProfileViewBasic(e.author)
    if(!author) return {error: "Ocurrió un error al cargar el contenido."}

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#articleView",
            uri: e.uri,
            cid: e.cid,
            summary: e.content && e.content.summary ? e.content.summary : undefined,
            summaryFormat: "plain-text",
            author,
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


function hydrateSelectionQuoteEmbedView(embed: SelectionQuoteEmbed, quotedContent: string, data: Dataplane): $Typed<SelectionQuoteEmbedView> | null {
    const caData = data.data.caContents?.get(quotedContent)
    const topicView = data.data.topicViews?.get(quotedContent)
    const article = data.data.articleViewsForSelectionQuotes?.get(quotedContent)

    if (topicView) {
        return {
            $type: "ar.cabildoabierto.embed.selectionQuote#view",
            start: embed.start,
            end: embed.end,
            quotedText: topicView.text,
            quotedTextFormat: topicView.format,
            quotedContentTitle: getTopicTitle(topicView),
            quotedContent,
            quotedContentAuthor: topicView.author
        }
    } else if (caData && caData.content && caData.content.text) {
        const author = queryResultToProfileViewBasic(caData.author)
        if(!author) return null
        return {
            $type: "ar.cabildoabierto.embed.selectionQuote#view",
            start: embed.start,
            end: embed.end,
            quotedText: caData.content.text,
            quotedTextFormat: caData.content.format ?? undefined,
            quotedContentTitle: caData.content.article?.title,
            quotedContent,
            quotedContentAuthor: author
        }
    } else if (article) {
        return {
            $type: "ar.cabildoabierto.embed.selectionQuote#view",
            start: embed.start,
            end: embed.end,
            quotedText: article.text,
            quotedTextFormat: article.format,
            quotedContentTitle: article.title,
            quotedContent,
            quotedContentAuthor: article.author
        }
    } else {
        return null
    }
}


function hydratePostView(uri: string, data: Dataplane): { data?: $Typed<PostView>, error?: string } {
    const post = data.data.bskyPosts?.get(uri)
    const caData = data.data.caContents?.get(uri)

    if (!post) {
        return {error: "Ocurrió un error al cargar el contenido."}
    }

    const record = post.record as PostRecord
    const embed = record.embed

    let embedView: PostView["embed"] = post.embed
    if (isSelectionQuoteEmbed(embed) && record.reply) {
        const view = hydrateSelectionQuoteEmbedView(embed, record.reply.parent.uri, data)
        if (view) {
            embedView = view;
        } else {
            console.log("No se encontraron los datos para el selection quote en el post: ", uri)
            console.log(data.data.articleViewsForSelectionQuotes)
        }
    }

    return {
        data: {
            ...post,
            author: {
                ...post.author,
                caProfile: caData?.author.CAProfileUri ?? undefined,
                $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
            },
            $type: "ar.cabildoabierto.feed.defs#postView",
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


export function hydrateContent(uri: string, data: Dataplane, full: boolean = false): {
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


export function hydrateFeedViewContent(e: SkeletonFeedPost, data: Dataplane): $Typed<FeedViewContent> | $Typed<NotFoundPost> {
    const reason = e.reason

    const childBsky = data.data.bskyPosts?.get(e.post)
    const reply = childBsky ? (childBsky.record as PostRecord).reply : null

    if(isPost(getCollectionFromUri(e.post)) && childBsky) {
        console.log("Warning: No se encontró el post en Bluesky. Uri: ", e.post)
    }

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


export async function getBskyPosts(agent: SessionAgent, uris: string[]): Promise<Map<string, BskyPostView>> {
    const postsList = uris.filter(uri => (getCollectionFromUri(uri) == "app.bsky.feed.post"))

    if (postsList.length == 0) {
        return new Map()
    } else {
        const batches: string[][] = []
        for (let i = 0; i < postsList.length; i += 25) {
            batches.push(postsList.slice(i, i + 25))
        }
        const results = await Promise.all(batches.map(b => agent.bsky.getPosts({uris: b})))
        const postViews = results.map(r => r.data.posts).reduce((acc, cur) => [...acc, ...cur])

        let m = new Map<string, BskyPostView>(
            postViews.map(item => [item.uri, item])
        )

        m = addEmbedsToPostsMap(m)

        return m
    }
}


export async function getCAFeedContents(ctx: AppContext, uris: string[]): Promise<Map<string, FeedElementQueryResult>> {
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

    // logTimes("get feed ca contents", [t1, t2, t3])

    return m
}


function addEmbedsToPostsMap(m: Map<string, BskyPostView>) {
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


const fetchArticleBlob = async (val: FeedElementQueryResult) => {
    if (!val.content || !val.content.textBlob) return null
    const blob = val.content.textBlob
    return await getTextFromBlob({cid: blob.cid, authorId: val.author.did})
}

export function getBlobKey(blob: BlobRef) {
    return blob.cid + ":" + blob.authorId
}

const fetchTextBlobs = async (blobs: BlobRef[]) => {
    async function getKeyAndText(blob: BlobRef): Promise<[string, string] | null> {
        const text = await getTextFromBlob(blob)
        if (!text) return null
        return [getBlobKey(blob), text]
    }

    const texts = await Promise.all(blobs.map(getKeyAndText))
    return new Map<string, string>(texts.filter(x => x != null))
}


const fetchArticleBlobs = async (m: Map<string, FeedElementQueryResult>) => {
    const keys = Array.from(m.keys())

    const articles: FeedElementQueryResult[] = keys.filter((k) => {
        const val = m.get(k)
        return val && isArticle(val.collection) && val.content && val.content.textBlob
    }).map(k => gett(m, k))

    const texts = await Promise.all(articles.map(fetchArticleBlob))

    for (let i = 0; i < texts.length; i++) {
        const text = texts[i]
        if (!text) continue
        const val = articles[i]
        if (!val.content) continue

        const format = val.content.format
        let summary = ""
        if (format == "markdown") {
            summary = markdownToPlainText(text).slice(0, 150).replace("\n", " ")
        } else if (!format || format == "lexical-compressed") {
            const summaryJson = JSON.parse(decompress(text))
            summary = getAllText(summaryJson.root).slice(0, 150)
        }
        val.content.summary = summary
        val.content.text = text
    }
}


export async function getTopicViews(ctx: AppContext, agent: SessionAgent, uris: string[]): Promise<Map<string, TopicView>> {
    const topicUris = uris.filter(uri => (isTopicVersion(getCollectionFromUri(uri))))
    if (topicUris.length == 0) {
        return new Map()
    } else {
        const results = await Promise.all(topicUris.map(u => getTopicVersion(ctx, agent, u)))
        const list: [string, TopicView | null][] = range(topicUris.length)
            .map(i => [topicUris[i], results[i].data ? results[i].data : null])
        const valid: [string, TopicView][] = list.filter((x: [string, TopicView | null]) => x[1] != null) as [string, TopicView][]
        return new Map<string, TopicView>(valid)
    }
}


export type ArticleViewForSelectionQuote = {
    text: string
    format: string
    author: CAProfileViewBasic
    createdAt: Date
    title: string
}


export type BlobRef = { cid: string, authorId: string }


export async function getArticleViewsForSelectionQuotes(ctx: AppContext, agent: SessionAgent, uris: string[]): Promise<Map<string, ArticleViewForSelectionQuote>> {
    const articleUris = uris.filter(uri => (isArticle(getCollectionFromUri(uri))))
    if (articleUris.length == 0) {
        return new Map()
    } else {
        const articles = await ctx.db.record.findMany({
            select: {
                uri: true,
                ...authorQuery,
                createdAt: true,
                content: {
                    select: {
                        text: true,
                        textBlobId: true,
                        format: true,
                        article: {
                            select: {
                                title: true
                            }
                        }
                    }
                }
            },
            where: {
                collection: {
                    in: articleCollections
                },
                uri: {
                    in: articleUris
                }
            }
        })

        const blobRefs: { cid: string, authorId: string }[] = articles
            .map(a => (a.content?.textBlobId != null ? {cid: a.content.textBlobId, authorId: a.author.did} : null))
            .filter(x => x != null)

        const blobs = await fetchTextBlobs(blobRefs)

        return new Map<string, ArticleViewForSelectionQuote>(articles.map(a => {
            if (!a.content || !a.content.article) {
                return null
            }

            const author = queryResultToProfileViewBasic(a.author)
            if(!author) return null


            let text: string
            if(!a.content?.textBlobId && a.content?.text){
                text = a.content.text
            } else if(a.content?.textBlobId) {
                const blobRef = {cid: a.content.textBlobId, authorId: a.author.did}
                if(blobs.has(getBlobKey(blobRef))){
                    text = gett(blobs, getBlobKey(blobRef))
                } else {
                    return null
                }
            } else {
                return null
            }

            const res: [string, ArticleViewForSelectionQuote] = [
                a.uri,
                {
                    text,
                    format: a.content.format,
                    author,
                    createdAt: a.createdAt,
                    title: a.content.article.title
                }
            ]

            return res
        }).filter(x => x != null))
    }
}


export async function hydrateFeed(ctx: AppContext, agent: SessionAgent, skeleton: FeedSkeleton): Promise<$Typed<FeedViewContent>[]> {
    const data = new Dataplane(ctx, agent)
    await data.fetchHydrationData(skeleton)

    const feed = skeleton
        .map((e) => (hydrateFeedViewContent(e, data)))

    feed.filter(isNotFoundPost).forEach(x => {
        console.log("Post not found:", x.uri)
    })

    return feed.filter(x => isFeedViewContent(x))
}


export type ThreadSkeleton = {
    post: string
    replies?: { post: string }[]
}


export function hydrateThreadViewContent(skeleton: ThreadSkeleton, data: Dataplane, includeReplies: boolean = false): $Typed<ThreadViewContent> | null {
    const content = hydrateContent(skeleton.post, data, true).data
    if (!content) return null

    let replies: $Typed<ThreadViewContent>[] | undefined
    if (includeReplies && skeleton.replies) {
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


