import {$Typed} from "@atproto/api";
import {
    ArticleView,
    FeedViewContent,
    FullArticleView,
    isFeedViewContent,
    PostView,
    ThreadViewContent
} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {getCollectionFromUri, getDidFromUri, isArticle, isDataset, isPost, isTopicVersion} from "#/utils/uri";
import {isNotFoundPost, isReasonRepost, NotFoundPost, SkeletonFeedPost} from "#/lex-server/types/app/bsky/feed/defs";
import {FeedSkeleton} from "#/services/feed/feed";
import {decompress} from "#/utils/compression";
import {getAllText} from "#/services/wiki/diff";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post"
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {
    isMain as isSelectionQuoteEmbed,
    Main as SelectionQuoteEmbed,
    View as SelectionQuoteEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/selectionQuote"
import {isPostView, isThreadViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {isPostView as isBskyPostView} from "#/lex-api/types/app/bsky/feed/defs"
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateEmbedViews, hydrateTopicViewBasicFromUri} from "#/services/wiki/topics";
import {TopicProp, TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {DatasetView} from "#/lex-api/types/ar/cabildoabierto/data/dataset"
import {getTopicTitle} from "#/services/wiki/utils";
import {
    isDatasetDataSource,
    isTopicsDataSource,
    isMain as isVisualizationEmbed,
    Main as VisualizationEmbed,
    View as VisualizationEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/visualization"
import {hydrateDatasetView, hydrateTopicsDatasetView} from "#/services/dataset/read";
import {ArticleEmbed, Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {isMain as isRecordEmbed, Main as RecordEmbed} from "#/lex-api/types/app/bsky/embed/record"
import {
    isMain as isCARecordEmbed,
    Main as CARecordEmbed,
    View as CARecordEmbedView
} from "#/lex-api/types/ar/cabildoabierto/embed/record"
import {
    BlockedPost,
    isSkeletonReasonRepost,
    isThreadViewPost,
    ThreadViewPost
} from "@atproto/api/dist/client/types/app/bsky/feed/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile"
import removeMarkdown from "remove-markdown"
import {
    isColumnFilter,
} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"


export function hydrateViewer(uri: string, data: Dataplane): { repost?: string, like?: string } {
    return {
        repost: data.reposts?.get(uri)?.uri ?? undefined,
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

    const authorId = getDidFromUri(e.uri)
    const author = hydrateProfileViewBasic(authorId, data)
    const viewer = hydrateViewer(e.uri, data)
    if (!author) return {error: "Ocurrió un error al cargar el contenido."}

    const record = e.record ? JSON.parse(e.record) as ArticleRecord : undefined

    let text: string | null = null
    let format: string | null = null
    if(e.content?.text != null){
        text = e.content.text
        format = e.content.dbFormat ?? null
    } else if (e.content?.textBlobId) {
        text = data.getFetchedBlob({cid: e.content?.textBlobId, authorId})
        format = e.content?.format ?? null
    }

    if (text == null || !e.content || !e.content.article || !e.content.article.title) return {error: "Ocurrió un error al cargar el contenido."}

    const embeds = hydrateEmbedViews(author.did, record?.embeds ?? [])
    const {summary, summaryFormat} = getArticleSummary(text, format ?? undefined)

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#fullArticleView",
            uri: e.uri,
            cid: e.cid,
            title: e.content.article.title,
            text,
            format: format ?? undefined,
            summary,
            summaryFormat,
            author,
            labels: dbLabelsToLabelsView(e.content?.selfLabels ?? [], uri),
            record: e.record ? JSON.parse(e.record) : {},
            indexedAt: new Date(e.createdAt).toISOString(),
            likeCount: e.uniqueLikesCount,
            repostCount: e.uniqueRepostsCount,
            replyCount: e._count.replies,
            viewer,
            topicsMentioned: topicsMentioned.map(m => ({
                count: m.count,
                title: getTopicTitle({id: m.referencedTopic.id, props: m.referencedTopic?.currentVersion?.props as TopicProp[] | undefined}),
                id: m.referencedTopic.id
            })),
            embeds
        }
    }
}


function dbLabelsToLabelsView(labels: string[], uri: string){
    const did = getDidFromUri(uri)
    return labels.map(l => ({
        val: l, src: did, uri: uri, cts: new Date().toISOString() // TO DO: Almacenar las timestamps de las labels
    }))
}


export function markdownToPlainText(md: string){
    return removeMarkdown(md)
        .trim()
        .replaceAll("\n", " ")
        .replaceAll("\\n", " ")
        .replaceAll("\|", " ")
        .replaceAll("\-\-\-", " ")
}


export function getArticleSummary(text: string | null, format?: string) {
    if(text == null){
        return {
            summary: "Contenido no encontrado.",
            summaryFormat: "plain-text"
        }
    }
    let summary = ""
    if (format == "markdown") {
        summary = markdownToPlainText(text)
            .slice(0, 150)
            .trim()
    } else if (!format || format == "lexical-compressed") {
        const summaryJson = JSON.parse(decompress(text))
        summary = getAllText(summaryJson.root).slice(0, 150).replaceAll("\n", " ")
    }
    return {summary, summaryFormat: "plain-text"}
}


export function hydrateArticleView(uri: string, data: Dataplane): {
    data?: $Typed<ArticleView>
    error?: string
} {
    const e = data.caContents?.get(uri)
    if (!e) {
        console.log(`No se encontraron los datos para hidratar el artículo: ${uri}`)
        return {error: "Ocurrió un error al cargar el contenido."}
    }

    const viewer = hydrateViewer(e.uri, data)
    const authorId = getDidFromUri(e.uri)
    const author = hydrateProfileViewBasic(authorId, data)
    if (!author) return {error: "No se encontró el autor del contenido."}

    let text: string | null = null
    let format: string | null = null
    if(e.content?.text != null){
        text = e.content.text
        format = e.content.dbFormat ?? null
    } else if (e.content?.textBlobId) {
        text = data.getFetchedBlob({cid: e.content?.textBlobId, authorId})
        format = e.content?.format ?? null
    }

    if (!e.content?.article?.title) {
        console.log(`No se encontraron los datos para hidratar el artículo (título): ${uri}`, !text || !e.content || !e.content.article || !e.content.article.title)
        return {error: "Ocurrió un error al cargar el artículo."}
    }

    const {summary, summaryFormat} = getArticleSummary(text, format ?? undefined)

    return {
        data: {
            $type: "ar.cabildoabierto.feed.defs#articleView",
            uri: e.uri,
            cid: e.cid,
            title: e.content.article.title,
            summary,
            summaryFormat,
            labels: dbLabelsToLabelsView(e.content?.selfLabels ?? [], uri),
            author,
            record: e.record ? JSON.parse(e.record) : {},
            indexedAt: new Date(e.createdAt).toISOString(),
            likeCount: e.uniqueLikesCount,
            repostCount: e.uniqueRepostsCount,
            replyCount: e._count.replies,
            viewer
        }
    }
}


function hydrateSelectionQuoteEmbedView(embed: SelectionQuoteEmbed, quotedContent: string, data: Dataplane): $Typed<SelectionQuoteEmbedView> | null {
    const caData = data.caContents?.get(quotedContent)

    if (caData && caData.content && caData.content) {
        const authorId = getDidFromUri(caData.uri)
        const author = hydrateProfileViewBasic(authorId, data)
        if (!author) {
            console.log("couldn't find author of quoted content:", authorId)
            return null
        }

        const record = caData.record ? JSON.parse(caData.record) as ArticleRecord | TopicVersionRecord : null

        let text: string | null = null
        let format: string | null = null
        if(caData.content?.text != null){
            text = caData.content.text
            format = caData.content.dbFormat ?? null
        } else if (caData.content?.textBlobId) {
            text = data.getFetchedBlob({cid: caData.content?.textBlobId, authorId})
            format = record?.format ?? null
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

        const embedsData = caData.content.embeds ?? []
        const embeds = hydrateEmbedViews(author.did, embedsData as unknown as ArticleEmbed[])

        return {
            $type: "ar.cabildoabierto.embed.selectionQuote#view",
            start: embed.start,
            end: embed.end,
            quotedText: text,
            quotedTextFormat: format ?? undefined,
            quotedContentTitle: title,
            quotedContent,
            quotedContentAuthor: author,
            quotedContentEmbeds: embeds
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
                visualization: embed,
                dataset,
                $type: "ar.cabildoabierto.embed.visualization#view",
            }
        }
    } else if(isTopicsDataSource(embed.dataSource)){
        const filters = embed.filters?.filter(isColumnFilter) ?? []
        const dataset = hydrateTopicsDatasetView(filters, data)
        if(dataset){
            return {
                visualization: embed,
                dataset,
                $type: "ar.cabildoabierto.embed.visualization#view",
            }
        }
    }
    return null
}


function hydrateRecordEmbedView(embed: CARecordEmbed | RecordEmbed, data: Dataplane): $Typed<CARecordEmbedView> | null {
    const uri = embed.record.uri
    const collection = getCollectionFromUri(uri)

    if(isArticle(collection)) {
        const artView = hydrateArticleView(uri, data)
        if(artView.data) {
            return {
                $type: "ar.cabildoabierto.embed.record#view",
                record: artView.data
            }
        }
    } else if(isPost(collection)) {
        const post = hydratePostView(uri, data)
        if(post.data){
            return {
                $type: "ar.cabildoabierto.embed.record#view",
                record: post.data
            }
        }
    } else {
        console.log(`Warning: Hidratación sin implementar para ${collection}.`)
    }

    return null
}


export function hydratePostView(uri: string, data: Dataplane): { data?: $Typed<PostView>, error?: string } {
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
    } else if(isVisualizationEmbed(embed)) {
        const view = hydrateVisualizationEmbedView(embed, data)
        if (view) {
            embedView = view;
        } else {
            console.log("Warning: No se encontraron los datos para la visualización: ", uri)
        }
    } else if(isRecordEmbed(embed) || isCARecordEmbed(embed)){
        const view = hydrateRecordEmbedView(embed, data)
        if (view) {
            embedView = view;
        } else {
            console.log("Warning: No se encontraron los datos para el record embed:", embed.record.uri, "embedido en", uri)
        }
    }

    const authorId = getDidFromUri(post.uri)
    const author = hydrateProfileViewBasic(authorId, data)
    if(!author) {
        console.log("Warning: No se encontraron los datos del autor:", post.uri)
        return {error: "No se encontraron los datos del autor."}
    }

    const rootCreationDate = data.rootCreationDates?.get(uri)

    console.log("QuoteCount", caData?._count.quotes)

    return {
        data: {
            ...post,
            author,
            labels: dbLabelsToLabelsView(caData?.content?.selfLabels ?? [], uri),
            $type: "ar.cabildoabierto.feed.defs#postView",
            embed: embedView,
            ...(caData ? {
                likeCount: caData.uniqueLikesCount,
                repostCount: caData.uniqueRepostsCount,
                quoteCount: caData._count.quotes
            } : {
                likeCount: 0,
                repostCount: 0,
                quoteCount: 0
            }),
            bskyLikeCount: post.likeCount,
            bskyRepostCount: post.repostCount,
            bskyQuoteCount: post.quoteCount,
            replyCount: post.replyCount,
            rootCreationDate: rootCreationDate?.toISOString()
        }
    }
}


export function hydrateContent(uri: string, data: Dataplane, full: boolean = false): {
    data?: $Typed<PostView> | $Typed<ArticleView> | $Typed<FullArticleView> | $Typed<TopicViewBasic> | $Typed<DatasetView>,
    error?: string
} {
    const collection = getCollectionFromUri(uri)
    if (isPost(collection)) {
        return hydratePostView(uri, data)
    } else if (isArticle(collection)) {
        return full ? hydrateFullArticleView(uri, data) : hydrateArticleView(uri, data)
    } else if (isTopicVersion(collection)) {
        return hydrateTopicViewBasicFromUri(uri, data)
    } else if(isDataset(collection)) {
        const res = hydrateDatasetView(uri, data)
        if(res) return {data: res}; else return {error: "No se pudo hidratar el dataset."}
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


function hydrateFeedViewContentReason(subjectUri: string, reason: SkeletonFeedPost["reason"], data: Dataplane): FeedViewContent["reason"] | null {
    if(!reason) return null
    if(isSkeletonReasonRepost(reason) && reason.repost){
        const user = hydrateProfileViewBasic(getDidFromUri(reason.repost), data)
        if(!user) {
            console.log("Warning: no se encontró el usuario autor del repost", getDidFromUri(reason.repost))
            return null
        }
        const repostData = data.reposts.get(subjectUri)
        if(!repostData || !repostData.createdAt) {
            console.log("Warning: no se encontró el repost", reason.repost)
            return null
        }
        const indexedAt = repostData.createdAt.toISOString()
        return {
            $type: "app.bsky.feed.defs#reasonRepost",
            by: {
                ...user,
                $type: "app.bsky.actor.defs#profileViewBasic",
            },
            indexedAt
        }
    } else if(isReasonRepost(reason)){
        return reason
    }
    return null
}


export function hydrateFeedViewContent(e: SkeletonFeedPost, data: Dataplane): $Typed<FeedViewContent> | $Typed<NotFoundPost> {
    const reason = hydrateFeedViewContentReason(e.post, e.reason, data) ?? undefined

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
    replies?: ThreadSkeleton[]
    parent?: ThreadSkeleton
}


type ThreadViewContentReply = $Typed<ThreadViewContent> | $Typed<NotFoundPost> | $Typed<BlockedPost> | {$type: string}


export const threadRepliesSortKey = (authorId: string) => (r: ThreadViewContentReply) => {
    return isThreadViewContent(r) && isPostView(r.content) && r.content.author.did == authorId ?
        [1, -new Date(r.content.indexedAt).getTime()] : [0, 0]
}


export const threadPostRepliesSortKey = (authorId: string) => (r: ThreadViewPost) => {
    return isThreadViewPost(r) &&
        isBskyPostView(r.post) &&
        r.post.author.did == authorId ?
        [1, -new Date(r.post.indexedAt).getTime()] : [0, 0]
}

export function hydrateThreadViewContent(skeleton: ThreadSkeleton, data: Dataplane, includeReplies: boolean = false, isMain: boolean = false): $Typed<ThreadViewContent> | null {
    const content = hydrateContent(skeleton.post, data, isMain).data
    if (!content) return null

    const authorDid = getDidFromUri(skeleton.post)

    let replies: $Typed<ThreadViewContent>[] | undefined
    if (includeReplies && skeleton.replies) {
        replies = skeleton.replies
            .map((r) => (hydrateThreadViewContent(r, data, true)))
            .filter(x => x != null)

        replies = sortByKey(replies, threadRepliesSortKey(authorDid), listOrderDesc)
    }

    let parent: $Typed<ThreadViewContent> | undefined
    if(skeleton.parent){
        const hydratedParent = hydrateThreadViewContent(skeleton.parent, data, false)
        if(hydratedParent) {
            parent = {
                ...hydratedParent,
                $type: "ar.cabildoabierto.feed.defs#threadViewContent"
            }
        }
    }

    return {
        $type: "ar.cabildoabierto.feed.defs#threadViewContent",
        content,
        replies,
        parent
    }
}


