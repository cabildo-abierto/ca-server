import {SessionAgent} from "#/utils/session-agent.js";
import {$Typed} from "@atproto/api";
import {ATProtoStrongRef} from "#/lib/types.js";
import {Image} from "#/lex-api/types/app/bsky/embed/images.js";
import {uploadImageBlob} from "#/services/blob.js";
import {CAHandler} from "#/utils/handler.js";
import {View as ExternalEmbedView} from "#/lex-server/types/app/bsky/embed/external.js"
import {Main as EmbedRecord} from "#/lex-server/types/app/bsky/embed/record.js"
import {Main as EmbedRecordWithMedia} from "#/lex-server/types/app/bsky/embed/recordWithMedia.js"
import {Main as Visualization} from "#/lex-server/types/ar/cabildoabierto/embed/visualization.js"
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post.js"
import {getParsedPostContent} from "#/services/write/rich-text.js";
import {PostRecordProcessor} from "#/services/sync/event-processing/post.js";
import {AppContext} from "#/setup.js";
import {deleteRecords} from "#/services/delete.js";

function createQuotePostEmbed(post: ATProtoStrongRef): $Typed<EmbedRecord> {
    return {
        $type: "app.bsky.embed.record",
        record: {
            $type: 'com.atproto.repo.strongRef',
            uri: post.uri,
            cid: post.cid
        }
    }
}


async function externalEmbedViewToMain(agent: SessionAgent, embed: ExternalEmbedView) {
    const external = embed.external
    if (external.thumb) {
        const {ref} = await uploadImageBlob(agent, {$type: "url", src: external.thumb})
        return {
            $type: "app.bsky.embed.external",
            external: {
                title: external.title ?? "",
                description: external.description ?? "",
                thumb: ref,
                uri: external.uri
            }
        }
    } else {
        return {
            $type: "app.bsky.embed.external",
            external: {
                title: external.title ?? "",
                description: external.description ?? "",
                uri: external.uri
            }
        }
    }
}


async function getImagesEmbed(agent: SessionAgent, images: ImagePayload[]) {
    const blobs = await Promise.all(images.map(image => uploadImageBlob(agent, image)))

    const imagesEmbed: Image[] = blobs.map((({ref, size}) => {

        return {
            alt: "",
            image: ref,
            aspectRatio: {
                width: size.width,
                height: size.height
            }
        }
    }))

    return {
        $type: "app.bsky.embed.images",
        images: imagesEmbed
    }
}


function getRecordWithMedia(quotedPost: ATProtoStrongRef, media: EmbedRecordWithMedia["media"]) {
    return {
        $type: "app.bsky.embed.recordWithMedia",
        record: {
            record: {
                uri: quotedPost.uri,
                cid: quotedPost.cid
            }
        },
        media
    }
}


async function getPostEmbed(agent: SessionAgent, post: CreatePostProps): Promise<PostRecord["embed"] | undefined> {
    if (post.selection) {
        return {
            $type: "ar.cabildoabierto.embed.selectionQuote",
            start: post.selection[0],
            end: post.selection[1]
        }
    } else if (post.images && post.images.length > 0) {
        const imagesEmbed = await getImagesEmbed(agent, post.images)
        if (!post.quotedPost) {
            return imagesEmbed
        } else {
            return getRecordWithMedia(post.quotedPost, imagesEmbed)
        }
    } else if (post.externalEmbedView) {
        const externalEmbed = await externalEmbedViewToMain(agent, post.externalEmbedView)
        if (!post.quotedPost) {
            return externalEmbed
        } else {
            return getRecordWithMedia(post.quotedPost, externalEmbed)
        }
    } else if (post.quotedPost) {
        return createQuotePostEmbed(post.quotedPost)
    } else if (post.visualization) {
        return {
            ...post.visualization,
            $type: "ar.cabildoabierto.embed.visualization"
        }
    }
    return undefined
}


export async function createPostAT({
    ctx,
                                       agent,
                                       post
                                   }: {
    ctx: AppContext
    agent: SessionAgent
    post: CreatePostProps
}): Promise<{ ref: ATProtoStrongRef, record: PostRecord }> {
    const rt = getParsedPostContent(post.text)

    const embed = await getPostEmbed(agent, post)

    let record: PostRecord = {
        $type: "app.bsky.feed.post",
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
        reply: post.reply,
        embed,
        labels: post.enDiscusion ? {
            $type: "com.atproto.label.defs#selfLabels",
            values: [{val: "ca:en discusión"}]
        } : undefined
    }

    const ref = await agent.bsky.post({...record})
    return {ref, record}
}


export type FastPostReplyProps = {
    parent: ATProtoStrongRef
    root: ATProtoStrongRef
}

export type ImagePayload = { src: string, $type: "url" } | { $type: "file", base64: string }

export type CreatePostProps = {
    text: string
    reply?: FastPostReplyProps
    selection?: [number, number]
    images?: ImagePayload[]
    enDiscusion?: boolean
    externalEmbedView?: $Typed<ExternalEmbedView>
    quotedPost?: ATProtoStrongRef
    visualization?: Visualization
    uri?: string
}


export async function isContentReferenced(ctx: AppContext, uri: string) {
    const references = await ctx.kysely
        .selectFrom("Content")
        .innerJoin("Record", "Content.uri", "Record.uri")
        .select(eb => [
            "Content.uri",
            eb.exists(eb
                .selectFrom("Reaction")
                .select([])
                .whereRef("Reaction.subjectId", "=", "Content.uri")
            ).as("reactions"),
            eb.exists(eb
                .selectFrom("Post")
                .select([])
                .whereRef("Post.replyToId", "=", "Content.uri")
            ).as("replies"),
            eb.exists(eb
                .selectFrom("Post")
                .select([])
                .whereRef("Post.quoteToId", "=", "Content.uri")
            ).as("quotes")
        ])
        .where("Content.uri", "=", uri)
        .executeTakeFirst()

    if(!references) return {error: "No se encontró la publicación que se está editando."}
    return {
        data: references.reactions || references.replies || references.quotes
    }
}


export const createPost: CAHandler<CreatePostProps, ATProtoStrongRef> = async (ctx, agent, post) => {
    if(post.uri) {
        // se está editando un post
        const {data: referenced, error} = await isContentReferenced(ctx, post.uri)
        if(error) return {error}
        if(referenced){
            return {error: "La publicación ya fue referenciada y no se puede editar. Si querés, podés eliminarla."}
        } else {
            await deleteRecords({ctx, agent, uris: [post.uri], atproto: true})
        }
    }

    const {ref, record} = await createPostAT({ctx, agent, post})

    await new PostRecordProcessor(ctx).processValidated([{ref, record}])

    return {data: ref}
}