import {$Typed} from "@atproto/api";
import {
    ArticleView,
    FeedViewContent,
    FullArticleView,
    isFeedViewContent,
    PostView,
    ThreadViewContent
} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs"
import {getCollectionFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri";
import {
    isNotFoundPost,
    isReasonRepost,
    NotFoundPost,
    SkeletonFeedPost
} from "#/lex-server/types/app/bsky/feed/defs";
import {FeedSkeleton} from "#/services/feed/feed";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {decompress} from "#/utils/compression";
import {getAllText} from "#/services/topic/diff";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post"
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {
    isMain as isSelectionQuoteEmbed,
    Main as SelectionQuoteEmbed,
    View as SelectionQuoteEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/selectionQuote"
import {creationDateSortKey} from "#/services/feed/utils";
import {Dataplane, FeedElementQueryResult} from "#/services/hydration/dataplane";
import {markdownToPlainText} from "#/utils/lexical/transforms";
import {topicQueryResultToTopicViewBasic, hydrateTopicViewBasicFromUri} from "#/services/topic/topics";
import {TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";


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


export function hydrateViewer(uri: string, data: Dataplane): {repost?: string, like?: string} {
    return {
        repost: data.data.reposts?.get(uri) ?? undefined,
        like: data.data.likes?.get(uri) ?? undefined
    }
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

    let text: string | null = null
    if(e.content?.textBlobId){
        text = data.getFetchedBlob({cid: e.content?.textBlobId, authorId: e.author.did})
    } else if(e.content?.text){
        text = e.content.text
    }

    if(!text) return {error: "Ocurrió un error al cargar el contenido."}

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#fullArticleView",
            uri: e.uri,
            cid: e.cid,
            text,
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

    let text: string | null = null
    if(e.content?.textBlobId){
        text = data.getFetchedBlob({cid: e.content?.textBlobId, authorId: e.author.did})
    } else if(e.content?.text){
        text = e.content.text
    }

    if(!text) return {error: "Ocurrió un error al cargar el contenido."}

    const format = e.content?.format
    let summary = ""
    if (format == "markdown") {
        summary = markdownToPlainText(text).slice(0, 150).replace("\n", " ")
    } else if (!format || format == "lexical-compressed") {
        const summaryJson = JSON.parse(decompress(text))
        summary = getAllText(summaryJson.root).slice(0, 150)
    }

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#articleView",
            uri: e.uri,
            cid: e.cid,
            summary: summary,
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

    if (caData && caData.content && caData.content) {
        const author = queryResultToProfileViewBasic(caData.author)
        if(!author) return null

        let text: string | null = null
        if(caData.content?.textBlobId){
            text = data.getFetchedBlob({cid: caData.content.textBlobId, authorId: caData.author.did})
        } else if(caData.content?.text){
            text = caData.content.text
        }
        if(!text) return null

        return {
            $type: "ar.cabildoabierto.embed.selectionQuote#view",
            start: embed.start,
            end: embed.end,
            quotedText: text,
            quotedTextFormat: caData.content.format ?? undefined,
            quotedContentTitle: caData.content.article?.title,
            quotedContent,
            quotedContentAuthor: author
        }
    } else {
        return null
    }
}


function hydratePostView(uri: string, data: Dataplane): { data?: $Typed<PostView>, error?: string } {
    const post = data.data.bskyPosts?.get(uri)
    const caData = data.data.caContents?.get(uri)

    if (!post) {
        console.log("Warning: No se encontró el post en Bluesky. Uri: ", uri)
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
            console.log("Warning: No se encontraron los datos para el selection quote en el post: ", uri)
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
    data?: $Typed<PostView> | $Typed<ArticleView> | $Typed<FullArticleView> | $Typed<TopicViewBasic>,
    error?: string
} {
    const collection = getCollectionFromUri(uri)
    if (isPost(collection)) {
        return hydratePostView(uri, data)
    } else if (isArticle(collection)) {
        return full ? hydrateFullArticleView(uri, data) : hydrateArticleView(uri, data)
    } else if (isTopicVersion(collection)) {
        return hydrateTopicViewBasicFromUri(uri, data)
    } else {
        console.log("Warning: Hidratación no implementada para: ", collection)
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

    if(isPost(getCollectionFromUri(e.post)) && !childBsky) {
        console.log("Warning: No se encontró el post en Bluesky. Uri: ", e.post)
    }

    const leaf = hydrateContent(e.post, data)
    const parent = reply && !isReasonRepost(reason) ? hydrateContent(reply.parent.uri, data) : null
    const root = reply && !isReasonRepost(reason) ? hydrateContent(reply.root.uri, data) : null

    if(e.post == "at://did:plc:2356xofv4ntrbu42xeilxjnb/app.bsky.feed.post/3lobjotnmr42b"){
        console.log("Post: ", e.post)
        console.log("Reply: ", reply)
        console.log("Hydrated root:", root)
    }

    if (!leaf.data || leaf.error) {
        console.log("Warning: No se encontró el contenido en Bluesky. Uri: ", e.post)
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


export type ArticleViewForSelectionQuote = {
    text: string
    format: string
    author: CAProfileViewBasic
    createdAt: Date
    title: string
}


export type BlobRef = { cid: string, authorId: string }


export async function hydrateFeed(ctx: AppContext, agent: SessionAgent, skeleton: FeedSkeleton): Promise<$Typed<FeedViewContent>[]> {
    const data = new Dataplane(ctx, agent)
    await data.fetchFeedHydrationData(skeleton)

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


