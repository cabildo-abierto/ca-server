import {PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs.js";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post.js";
import {
    isMain as isVisualizationEmbed
} from "#/lex-server/types/ar/cabildoabierto/embed/visualization.js";
import {isMain as isRecordEmbed} from "#/lex-api/types/app/bsky/embed/record.js";
import {
    isMain as isRecordWithMediaEmbed
} from "#/lex-api/types/app/bsky/embed/recordWithMedia.js";
import {
    Image,
    isMain as isImageEmbed, ViewImage
} from "#/lex-api/types/app/bsky/embed/images.js";
import {
    isMain as isExternalEmbed
} from "#/lex-api/types/app/bsky/embed/external.js";
import { Hydrator } from "./hydrator.js";
import {
    isMain as isSelectionQuoteEmbed
} from "#/lex-server/types/ar/cabildoabierto/embed/selectionQuote.js";
import {hydrateProfileViewBasic} from "#/services/hydration/profile.js";
import {
    Main as SelectionQuoteEmbed,
    View as SelectionQuoteEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/selectionQuote.js";
import {
    $Typed,
    AppBskyEmbedExternal,
    AppBskyEmbedImages,
    AppBskyEmbedRecordWithMedia,
    AppBskyEmbedVideo, AppBskyFeedDefs
} from "@atproto/api";
import {getCollectionFromUri, getDidFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri.js";
import {ArticleEmbed, Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article.js";
import {Record as TopicVersionRecord, TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js";
import {getTopicTitle} from "#/services/wiki/utils.js";
import {hydrateEmbedViews} from "#/services/wiki/topics.js";
import {
    isDatasetDataSource,
    isTopicsDataSource,
    Main as VisualizationEmbed,
    View as VisualizationEmbedView
} from "#/lex-server/types/ar/cabildoabierto/embed/visualization.js";
import {Main as RecordEmbed} from "#/lex-api/types/app/bsky/embed/record.js";
import {
    View as CARecordEmbedView
} from "#/lex-api/types/ar/cabildoabierto/embed/record.js";
import {
    View as CARecordWithMediaEmbedView
} from "#/lex-api/types/ar/cabildoabierto/embed/recordWithMedia.js";
import {
    Main as RecordWithMediaEmbed
} from "#/lex-api/types/app/bsky/embed/recordWithMedia.js";
import {hydrateDatasetView, hydrateTopicsDatasetView} from "#/services/dataset/read.js";
import {isColumnFilter} from "#/lex-api/types/ar/cabildoabierto/embed/visualization.js";
import {hydrateArticleView} from "#/services/hydration/hydrate.js";
import {
    Main as ImagesEmbed,
    View as ImagesEmbedView
} from "#/lex-api/types/app/bsky/embed/images.js";
import {
    Main as ExternalEmbed,
    View as ExternalEmbedView
} from "#/lex-api/types/app/bsky/embed/external.js";
import {PostViewHydrator} from "#/services/hydration/post-view.js";


export class EmbedHydrator extends Hydrator<string, PostView["embed"]> {

    hydrate(uri: string): PostView["embed"] | null {
        const post = this.dataplane.bskyPosts?.get(uri)
        const caData = this.dataplane.caContents?.get(uri)
        if(!post) {
            return null
        }

        const record = caData?.record ? JSON.parse(caData.record) as PostRecord : post.record as PostRecord
        const embed = record.embed

        const authorId = getDidFromUri(uri)

        if (isSelectionQuoteEmbed(embed) && record.reply) {
            return this.hydrateSelectionQuoteEmbedView(
                embed,
                record.reply.parent.uri
            )
        } else if (isVisualizationEmbed(embed)) {
            return this.hydrateVisualizationEmbedView(embed)
        } else if (isRecordEmbed(embed)) {
            return this.hydrateRecordEmbedView(embed)
        } else if(isRecordWithMediaEmbed(embed)) {
            return this.hydrateRecordWithMediaEmbedView(embed, authorId, post)
        } else if (isImageEmbed(embed)) {
            return this.hydrateImageEmbedView(
                embed,
                authorId
            )
        } else if (isExternalEmbed(embed)) {
            return this.hydrateExternalEmbedView( embed, authorId)
        }

        return post.embed
    }

    hydrateRecordWithMediaEmbedView(embed: $Typed<RecordWithMediaEmbed>, authorId: string, postView?: AppBskyFeedDefs.PostView): $Typed<CARecordWithMediaEmbedView> | null {
        const uri = embed.record.record.uri
        const record = this.hydrateRecordEmbedViewFromUri(uri)
        if(!record) return null

        let media: CARecordWithMediaEmbedView["media"]

        if(AppBskyEmbedImages.isMain(embed.media)){
            media = this.hydrateImageEmbedView(embed.media, authorId)
        } else if(AppBskyEmbedVideo.isMain(embed.media)) {
            if(postView && AppBskyEmbedRecordWithMedia.isView(postView.embed)) {
                media = postView.embed.media
            } else {
                this.ctx.logger.pino.error("video embed hydration not implemented")
                return null
            }
        } else if(AppBskyEmbedExternal.isMain(embed.media)) {
            media = this.hydrateExternalEmbedView(embed.media, authorId)
        } else {
            this.ctx.logger.pino.error({embed}, "hydration not implemented for media")
            return null
        }

        return {
            $type: "ar.cabildoabierto.embed.recordWithMedia#view",
            record,
            media
        }
    }


    hydrateRecordEmbedViewFromUri(uri: string): $Typed<CARecordEmbedView> | null {
        const collection = getCollectionFromUri(uri)

        if (isArticle(collection)) {
            const artView = hydrateArticleView(this.ctx, uri, this.dataplane)
            if (artView.data) {
                return {
                    $type: "ar.cabildoabierto.embed.record#view",
                    record: {
                        ...artView.data,
                        value: artView.data.record,
                        $type: "ar.cabildoabierto.embed.record#viewArticleRecord"
                    }
                }
            }
        } else if (isPost(collection)) {
            const post = new PostViewHydrator(this.ctx, this.dataplane)
                .hydrate(uri)
            if (post) {
                const embed = post.embed
                return {
                    $type: "ar.cabildoabierto.embed.record#view",
                    record: {
                        ...post,
                        embeds: embed ? [embed] : undefined,
                        value: post.record,
                        $type: "ar.cabildoabierto.embed.record#viewRecord"
                    }
                }
            }
        } else {
            this.ctx.logger.pino.warn({collection}, `hydration not implemented for collection`)
        }
        return null
    }


    hydrateRecordEmbedView(embed: $Typed<RecordEmbed>): $Typed<CARecordEmbedView> | null {
        const uri = embed.record.uri
        return this.hydrateRecordEmbedViewFromUri(uri)
    }

    hydrateVisualizationEmbedView(embed: VisualizationEmbed): $Typed<VisualizationEmbedView> | null {
        if (isDatasetDataSource(embed.dataSource)) {
            const datasetUri = embed.dataSource.dataset
            const dataset = hydrateDatasetView(
                this.ctx,
                datasetUri,
                this.dataplane
            )
            if (dataset) {
                return {
                    visualization: embed,
                    dataset,
                    $type: "ar.cabildoabierto.embed.visualization#view",
                }
            }
        } else if (isTopicsDataSource(embed.dataSource)) {
            const filters = embed.filters?.filter(isColumnFilter) ?? []
            const dataset = hydrateTopicsDatasetView(
                this.ctx,
                filters,
                this.dataplane
            )
            if (dataset) {
                return {
                    visualization: embed,
                    dataset,
                    $type: "ar.cabildoabierto.embed.visualization#view",
                }
            }
        } else {
            this.ctx.logger.pino.warn({embed}, "no se pudo hidratar la visualización")

        }
        return null
    }

    hydrateSelectionQuoteEmbedView(embed: SelectionQuoteEmbed, quotedContent: string): $Typed<SelectionQuoteEmbedView> | null {
        const caData = this.dataplane.caContents?.get(quotedContent)

        if (caData) {
            const authorId = getDidFromUri(caData.uri)
            const author = hydrateProfileViewBasic(this.ctx, authorId, this.dataplane)
            if (!author) {
                this.ctx.logger.pino.warn({authorId}, "couldn't find author of quoted content")
                return null
            }

            const record = caData.record ? JSON.parse(caData.record) as ArticleRecord | TopicVersionRecord : null

            let text: string | null = null
            let format: string | null = null
            if (caData.text != null) {
                text = caData.text
                format = caData.dbFormat ?? null
            } else if (caData.textBlobId) {
                text = this.dataplane.getFetchedBlob({cid: caData.textBlobId, authorId})
                format = record?.format ?? null
            }
            if (text == null) {
                this.ctx.logger.pino.warn({embed, quotedContent}, "couldn't find text of quoted content")
                return null
            }

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
            if (!title) {
                this.ctx.logger.pino.warn({embed, quotedContent}, "couldn't find title of quoted content")
                return null
            }

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
            this.ctx.logger.pino.warn({embed, quotedContent}, "data unavailable for selection quote embed hydration")
            return null
        }
    }

    hydrateImageEmbedView(embed: ImagesEmbed, authorId: string): $Typed<ImagesEmbedView> {
        const images = embed.images

        return {
            $type: "app.bsky.embed.images#view",
            images: images
                .map(i => this.hydrateImageInImagesEmbed(authorId, i))
                .filter(i => i != null)
        }
    }

    hydrateExternalEmbedView(embed: ExternalEmbed, authorId: string): $Typed<ExternalEmbedView> {
        const thumb = embed.external.thumb
        const cid = thumb ? (thumb.ref.$link ?? thumb.ref.toString()) : undefined

        return {
            $type: "app.bsky.embed.external#view",
            external: {
                uri: embed.external.uri,
                title: embed.external.title,
                description: embed.external.description,
                thumb: cid ? `https://cdn.bsky.app/img/feed_thumbnail/plain/${authorId}/${cid}@jpeg` : undefined
            }
        }
    }

    hydrateImageInImagesEmbed(authorId: string, i: Image): ViewImage | null {
        const cid = i.image ? (i.image.ref.$link ?? i.image.ref.toString()) : undefined
        if(!cid) return null
        return {
            $type: "app.bsky.embed.images#viewImage",
            thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${authorId}/${cid}@jpeg`,
            fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/${authorId}/${cid}@jpeg`,
            alt: i.alt,
            aspectRatio: i.aspectRatio
        }
    }
}