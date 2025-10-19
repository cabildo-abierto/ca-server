import {$Typed} from "@atproto/api";
import {getDidFromUri} from "#/utils/uri.js";
import {hydrateProfileViewBasic} from "#/services/hydration/profile.js";
import {PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs.js";
import {dbLabelsToLabelsView, hydrateViewer} from "#/services/hydration/hydrate.js";
import {EmbedHydrator} from "#/services/hydration/embed.js";
import {Hydrator} from "#/services/hydration/hydrator.js";


export class PostViewHydrator extends Hydrator<string, $Typed<PostView>> {
    hydrate(uri: string): $Typed<PostView> | null {
        const post = this.dataplane.bskyPosts?.get(uri)
        const caData = this.dataplane.caContents?.get(uri)

        if (!post) {
            this.ctx.logger.pino.warn({uri}, "no se encontró el post en bsky")
            return null
        }

        const embedView = new EmbedHydrator(this.ctx, this.dataplane)
            .hydrate(uri)

        const authorId = getDidFromUri(post.uri)
        const author = hydrateProfileViewBasic(this.ctx, authorId, this.dataplane)
        if (!author) {
            this.ctx.logger.pino.warn({uri}, "Warning: No se encontraron los datos del autor")
            return null
        }

        const viewer = hydrateViewer(post.uri, this.dataplane)

        const rootCreationDate = this.dataplane.rootCreationDates?.get(uri)

        return {
            ...post,
            author,
            labels: dbLabelsToLabelsView(caData?.selfLabels ?? [], uri),
            $type: "ar.cabildoabierto.feed.defs#postView",
            embed: embedView ?? undefined,
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
    }
}