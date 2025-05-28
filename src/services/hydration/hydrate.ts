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
import {getCollectionFromUri, getDidFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri";
import {
    isNotFoundPost,
    isReasonRepost,
    NotFoundPost,
    SkeletonFeedPost
} from "#/lex-server/types/app/bsky/feed/defs";
import {FeedSkeleton} from "#/services/feed/feed";
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
import {hydrateTopicViewBasicFromUri} from "#/services/topic/topics";
import {TopicProp, TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicTitle} from "#/services/topic/utils";
import {isMain as isVisualizationEmbed, View as VisualizationEmbedView, Main as VisualizationEmbed, isDatasetDataSource} from "#/lex-server/types/ar/cabildoabierto/embed/visualization"
import {hydrateDatasetView} from "#/services/dataset/read";
import {ArticleEmbed} from "#/lex-api/types/ar/cabildoabierto/feed/article"


const queryResultToProfileViewBasic = (e: FeedElementQueryResult["author"]): CAProfileViewBasic | null => {
    if (!e.handle) return null
    return {
        $type: "ar.cabildoabierto.actor.defs#profileViewBasic",
        did: e.did,
        handle: e.handle,
        displayName: e.displayName ?? undefined,
        avatar: e.avatar ?? undefined,
        caProfile: e.CAProfileUri ?? undefined
    }
}


export function hydrateViewer(uri: string, data: Dataplane): { repost?: string, like?: string } {
    return {
        repost: data.reposts?.get(uri) ?? undefined,
        like: data.likes?.get(uri) ?? undefined
    }
}


export function hydrateFullArticleView(uri: string, data: Dataplane): {
    data?: $Typed<FullArticleView>
    error?: string
} {
    const e = data.caContents?.get(uri)
    if (!e) return {error: "Ocurrió un error al cargar el contenido."}

    const topicsMentioned = data.topicsMentioned?.get(uri) ?? []

    const viewer = hydrateViewer(e.uri, data)
    const author = queryResultToProfileViewBasic(e.author)
    if (!author) return {error: "Ocurrió un error al cargar el contenido."}

    let text: string | null = null
    if (e.content?.textBlobId) {
        text = data.getFetchedBlob({cid: e.content?.textBlobId, authorId: e.author.did})
    } else if (e.content?.text) {
        text = e.content.text
    }

    if (!text || !e.content || !e.content.article || !e.content.article.title) return {error: "Ocurrió un error al cargar el contenido."}

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#fullArticleView",
            uri: e.uri,
            cid: e.cid,
            title: e.content.article.title,
            text,
            format: e.content?.format ?? undefined,
            author,
            labels: dbLabelsToLabelsView(e.content?.selfLabels ?? [], uri),
            record: e.record ? JSON.parse(e.record) : {},
            indexedAt: new Date(e.createdAt).toISOString(),
            likeCount: e.uniqueLikesCount,
            repostCount: e.uniqueRepostsCount,
            replyCount: e._count.replies,
            uniqueViewsCount: e.uniqueViewsCount ?? undefined,
            viewer,
            topicsMentioned: topicsMentioned.map(m => ({
                count: m.count,
                title: getTopicTitle(m.referencedTopic),
                id: m.referencedTopic.id
            }))
        }
    }
}


function dbLabelsToLabelsView(labels: string[], uri: string){
    const did = getDidFromUri(uri)
    return labels.map(l => ({
        val: l, src: did, uri: uri, cts: new Date().toISOString() // TO DO: Almacenar las timestamps de las labels
    }))
}


export function hydrateArticleView(uri: string, data: Dataplane): {
    data?: $Typed<ArticleView>
    error?: string
} {
    const e = data.caContents?.get(uri)
    if (!e) return {error: "Ocurrió un error al cargar el contenido."}

    const viewer = hydrateViewer(e.uri, data)
    const author = queryResultToProfileViewBasic(e.author)
    if (!author) return {error: "Ocurrió un error al cargar el contenido."}

    let text: string | null = null
    if (e.content?.textBlobId) {
        text = data.getFetchedBlob({cid: e.content?.textBlobId, authorId: e.author.did})
    } else if (e.content?.text) {
        text = e.content.text
    }

    if (!text || !e.content || !e.content.article || !e.content.article.title) return {error: "Ocurrió un error al cargar el contenido."}

    const format = e.content?.format
    let summary = ""
    if (format == "markdown") {
        summary = markdownToPlainText(text).slice(0, 150).replaceAll("\n", " ")
    } else if (!format || format == "lexical-compressed") {
        const summaryJson = JSON.parse(decompress(text))
        summary = getAllText(summaryJson.root).slice(0, 150).replaceAll("\n", " ")
    }

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#articleView",
            uri: e.uri,
            cid: e.cid,
            title: e.content.article.title,
            summary: summary,
            summaryFormat: "plain-text",
            labels: dbLabelsToLabelsView(e.content?.selfLabels ?? [], uri),
            author,
            record: e.record ? JSON.parse(e.record) : {},
            indexedAt: new Date(e.createdAt).toISOString(),
            likeCount: e.uniqueLikesCount,
            repostCount: e.uniqueRepostsCount,
            replyCount: e._count.replies,
            uniqueViewsCount: e.uniqueViewsCount ?? undefined,
            viewer
        }
    }
}


function hydrateSelectionQuoteEmbedView(embed: SelectionQuoteEmbed, quotedContent: string, data: Dataplane): $Typed<SelectionQuoteEmbedView> | null {
    const caData = data.caContents?.get(quotedContent)

    if (caData && caData.content && caData.content) {
        const author = queryResultToProfileViewBasic(caData.author)
        if (!author) return null

        let text: string | null = null
        if (caData.content?.textBlobId) {
            text = data.getFetchedBlob({cid: caData.content.textBlobId, authorId: caData.author.did})
        } else if (caData.content?.text) {
            text = caData.content.text
        }
        if (!text) return null

        const collection = getCollectionFromUri(quotedContent)
        let title: string | undefined
        if (isArticle(collection)) {
            title = caData.content.article?.title
        } else if (isTopicVersion(collection) && caData.content.topicVersion?.topicId) {
            title = getTopicTitle({
                id: caData.content.topicVersion.topicId,
                props: caData.content.topicVersion.props as unknown as TopicProp[]
            })
        }
        if (!title) return null

        return {
            $type: "ar.cabildoabierto.embed.selectionQuote#view",
            start: embed.start,
            end: embed.end,
            quotedText: text,
            quotedTextFormat: caData.content.format ?? undefined,
            quotedContentTitle: title,
            quotedContent,
            quotedContentAuthor: author,
            quotedContentEmbeds: caData.content.embeds as unknown as ArticleEmbed[]
        }
    } else {
        return null
    }
}


function hydrateVisualizationEmbedView(embed: VisualizationEmbed, data: Dataplane): $Typed<VisualizationEmbedView> | null {
    if(isDatasetDataSource(embed.dataSource)){
        const datasetUri = embed.dataSource.dataset
        const dataset = hydrateDatasetView(datasetUri, data)
        if(dataset){
            return {
                ...embed,
                $type: "ar.cabildoabierto.embed.visualization#view",
                dataset
            }
        }
    }
    return null
}


function hydratePostView(uri: string, data: Dataplane): { data?: $Typed<PostView>, error?: string } {
    const post = data.bskyPosts?.get(uri)
    const caData = data.caContents?.get(uri)

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

    if(isVisualizationEmbed(embed)) {
        const view = hydrateVisualizationEmbedView(embed, data)
        if (view) {
            embedView = view;
        } else {
            console.log("Warning: No se encontraron los datos para la visualización: ", uri)
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
            labels: dbLabelsToLabelsView(caData?.content?.selfLabels ?? [], uri),
            $type: "ar.cabildoabierto.feed.defs#postView",
            embed: embedView,
            ...(caData ? {
                uniqueViewsCount: caData.uniqueViewsCount ?? undefined,
                likeCount: caData.uniqueLikesCount,
                repostCount: caData.uniqueRepostsCount,
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

    const childBsky = data.bskyPosts?.get(e.post)
    const reply = childBsky ? (childBsky.record as PostRecord).reply : null

    if (isPost(getCollectionFromUri(e.post)) && !childBsky) {
        console.log("Warning: No se encontró el post en Bluesky. Uri: ", e.post)
    }

    const leaf = hydrateContent(e.post, data)
    const parent = reply && !isReasonRepost(reason) ? hydrateContent(reply.parent.uri, data) : null
    const root = reply && !isReasonRepost(reason) ? hydrateContent(reply.root.uri, data) : null

    if (!leaf.data || leaf.error) {
        console.log("Warning: No se encontró el contenido. Uri: ", e.post)
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


export type BlobRef = { cid: string, authorId: string }


export async function hydrateFeed(skeleton: FeedSkeleton, data: Dataplane): Promise<$Typed<FeedViewContent>[]> {
    await data.fetchFeedHydrationData(skeleton)

    const feed = skeleton
        .map((e) => (hydrateFeedViewContent(e, data)))

    feed.filter(isNotFoundPost).forEach(x => {
        console.log("Content not found:", x.uri)
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


