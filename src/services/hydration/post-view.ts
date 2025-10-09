import {AppContext} from "#/setup.js";
import {
    isMain as isSelectionQuoteEmbed,
    Main as SelectionQuoteEmbed,
    View as SelectionQuoteEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/selectionQuote.js";
import {Dataplane} from "#/services/hydration/dataplane.js";
import {$Typed} from "@atproto/api";
import {getCollectionFromUri, getDidFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri.js";
import {hydrateProfileViewBasic} from "#/services/hydration/profile.js";
import {ArticleEmbed, Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article.js";
import {Record as TopicVersionRecord, TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js";
import {getTopicTitle} from "#/services/wiki/utils.js";
import {hydrateEmbedViews} from "#/services/wiki/topics.js";
import {PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs.js";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post.js";
import {
    isDatasetDataSource,
    isMain as isVisualizationEmbed,
    isTopicsDataSource,
    Main as VisualizationEmbed,
    View as VisualizationEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/visualization.js";
import {isMain as isRecordEmbed, Main as RecordEmbed} from "#/lex-api/types/app/bsky/embed/record.js";
import {
    isMain as isCARecordEmbed,
    Main as CARecordEmbed,
    View as CARecordEmbedView
} from "#/lex-api/types/ar/cabildoabierto/embed/record.js";
import {
    isMain as isRecordWithMediaEmbed,
    Main as RecordWithMediaEmbed
} from "#/lex-api/types/app/bsky/embed/recordWithMedia.js";
import {
    Image,
    isMain as isImageEmbed,
    Main as ImagesEmbed,
    View as ImagesEmbedView,
    ViewImage
} from "#/lex-api/types/app/bsky/embed/images.js";
import {
    isMain as isExternalEmbed,
    Main as ExternalEmbed,
    View as ExternalEmbedView
} from "#/lex-api/types/app/bsky/embed/external.js";
import {hydrateDatasetView, hydrateTopicsDatasetView} from "#/services/dataset/read.js";
import {isColumnFilter} from "#/lex-api/types/ar/cabildoabierto/embed/visualization.js";
import {dbLabelsToLabelsView, hydrateArticleView, hydrateViewer} from "#/services/hydration/hydrate.js";


function hydrateSelectionQuoteEmbedView(ctx: AppContext, embed: SelectionQuoteEmbed, quotedContent: string, data: Dataplane): $Typed<SelectionQuoteEmbedView> | null {
    const caData = data.caContents?.get(quotedContent)

    if (caData) {
        const authorId = getDidFromUri(caData.uri)
        const author = hydrateProfileViewBasic(ctx, authorId, data)
        if (!author) {
            ctx.logger.pino.warn({authorId}, "couldn't find author of quoted content")
            return null
        }

        const record = caData.record ? JSON.parse(caData.record) as ArticleRecord | TopicVersionRecord : null

        let text: string | null = null
        let format: string | null = null
        if (caData.text != null) {
            text = caData.text
            format = caData.dbFormat ?? null
        } else if (caData.textBlobId) {
            text = data.getFetchedBlob({cid: caData.textBlobId, authorId})
            format = record?.format ?? null
        }
        if (!text) return null

        const collection = getCollectionFromUri(quotedContent)
        let title: string | undefined
        if (isArticle(collection)) {
            title = caData.title ?? undefined
        } else if (isTopicVersion(collection) && caData.topicId) {
            title = getTopicTitle({
                id: caData.topicId,
                props: caData.props as TopicProp[]
            })
        }
        if (!title) return null

        const embedsData = caData.embeds ?? []
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

function hydrateVisualizationEmbedView(ctx: AppContext, embed: VisualizationEmbed, data: Dataplane): $Typed<VisualizationEmbedView> | null {
    if (isDatasetDataSource(embed.dataSource)) {
        const datasetUri = embed.dataSource.dataset
        const dataset = hydrateDatasetView(ctx, datasetUri, data)
        if (dataset) {
            return {
                visualization: embed,
                dataset,
                $type: "ar.cabildoabierto.embed.visualization#view",
            }
        }
    } else if (isTopicsDataSource(embed.dataSource)) {
        const filters = embed.filters?.filter(isColumnFilter) ?? []
        const dataset = hydrateTopicsDatasetView(ctx, filters, data)
        if (dataset) {
            return {
                visualization: embed,
                dataset,
                $type: "ar.cabildoabierto.embed.visualization#view",
            }
        }
    }
    return null
}

function hydrateRecordEmbedView(ctx: AppContext, embed: $Typed<CARecordEmbed> | $Typed<RecordEmbed> | $Typed<RecordWithMediaEmbed>, data: Dataplane): $Typed<CARecordEmbedView> | null {
    const uri = isRecordWithMediaEmbed(embed) ? embed.record.record.uri : embed.record.uri
    const collection = getCollectionFromUri(uri)

    if (isArticle(collection)) {
        const artView = hydrateArticleView(ctx, uri, data)
        if (artView.data) {
            return {
                $type: "ar.cabildoabierto.embed.record#view",
                record: artView.data
            }
        }
    } else if (isPost(collection)) {
        const post = hydratePostView(ctx, uri, data)
        if (post.data) {
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

function hydrateImageInImagesEmbed(ctx: AppContext, authorId: string, i: Image): ViewImage {
    const cid = i.image.ref.$link
    return {
        $type: "app.bsky.embed.images#viewImage",
        thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${authorId}/${cid}@jpeg`,
        fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/${authorId}/${cid}@jpeg`,
        alt: i.alt,
        aspectRatio: i.aspectRatio
    }
}

function hydrateImageEmbedView(ctx: AppContext, embed: ImagesEmbed, authorId: string, data: Dataplane): $Typed<ImagesEmbedView> {
    const images = embed.images

    return {
        $type: "app.bsky.embed.images#view",
        images: images.map(i => hydrateImageInImagesEmbed(ctx, authorId, i))
    }
}

function hydrateExternalEmbedView(ctx: AppContext, embed: ExternalEmbed, authorId: string): $Typed<ExternalEmbedView> {
    const thumb = embed.external.thumb
    const cid = thumb ? thumb.ref.toString() : undefined

    ctx.logger.pino.info({
        cid,
        embed,
        thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${authorId}/${cid}@jpeg`}, "hydrating external")
    return {
        $type: "app.bsky.embed.external#view",
        external: {
            uri: embed.external.uri,
            title: embed.external.title,
            description: embed.external.description,
            thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${authorId}/${cid}@jpeg`
        }
    }
}

export function hydratePostView(ctx: AppContext, uri: string, data: Dataplane): {
    data?: $Typed<PostView>,
    error?: string
} {
    const post = data.bskyPosts?.get(uri)
    const caData = data.caContents?.get(uri)

    if (!post) {
        ctx.logger.pino.warn({uri}, "Warning: No se encontró el post en Bluesky.")
        return {error: "Ocurrió un error al cargar el contenido."}
    }

    const record = caData?.record ? JSON.parse(caData.record) as PostRecord : post.record as PostRecord
    const embed = record.embed

    let embedView: PostView["embed"] = post.embed
    if (isSelectionQuoteEmbed(embed) && record.reply) {
        const view = hydrateSelectionQuoteEmbedView(ctx, embed, record.reply.parent.uri, data)
        if (view) {
            embedView = view;
        } else {
            ctx.logger.pino.warn({uri}, "Warning: No se encontraron los datos para el selection quote en el post")
        }
    } else if (isVisualizationEmbed(embed)) {
        const view = hydrateVisualizationEmbedView(ctx, embed, data)
        if (view) {
            embedView = view;
        } else {
            ctx.logger.pino.warn({uri}, "Warning: No se encontraron los datos para la visualización")
        }
    } else if (isRecordEmbed(embed) ||
        isCARecordEmbed(embed) ||
        isRecordWithMediaEmbed(embed)) {
        const view = hydrateRecordEmbedView(ctx, embed, data)
        if (view) {
            embedView = view;
        } else {
            ctx.logger.pino.warn({
                uri,
                embedRecord: embed.record
            }, "Warning: No se encontraron los datos para el record embed")
        }
    } else if (isImageEmbed(embed)) {
        const view = hydrateImageEmbedView(ctx, embed, getDidFromUri(uri), data)
        if (view) {
            embedView = view
        } else {
            ctx.logger.pino.warn({
                uri,
                embed
            }, "Warning: No se encontraron los datos para el image embed")
        }
    } else if (isExternalEmbed(embed)) {
        const view = hydrateExternalEmbedView(ctx, embed, getDidFromUri(uri))
        if (view) {
            embedView = view
        } else {
            ctx.logger.pino.warn({
                uri,
                embed
            }, "Warning: No se encontraron los datos para el external embed")
        }
    }

    const authorId = getDidFromUri(post.uri)
    const author = hydrateProfileViewBasic(ctx, authorId, data)
    if (!author) {
        ctx.logger.pino.warn({uri}, "Warning: No se encontraron los datos del autor")
        return {error: "No se encontraron los datos del autor."}
    }

    const viewer = hydrateViewer(post.uri, data)

    const rootCreationDate = data.rootCreationDates?.get(uri)

    const postView: $Typed<PostView> = {
        ...post,
        author,
        labels: dbLabelsToLabelsView(caData?.selfLabels ?? [], uri),
        $type: "ar.cabildoabierto.feed.defs#postView",
        embed: embedView,
        ...(caData ? {
            record: caData.record ? JSON.parse(caData.record) : post.record,
            text: caData.text,
            likeCount: caData.uniqueLikesCount,
            repostCount: caData.uniqueRepostsCount,
            quoteCount: caData.quotesCount
        } : {
            likeCount: 0,
            repostCount: 0,
            quoteCount: 0
        }),
        bskyLikeCount: post.likeCount,
        bskyRepostCount: post.repostCount,
        bskyQuoteCount: post.quoteCount,
        replyCount: post.replyCount,
        rootCreationDate: rootCreationDate?.toISOString(),
        editedAt: caData?.editedAt?.toISOString(),
        viewer
    }
    return {data: postView}
}