import {processPost} from "../sync/process-event";
import {SessionAgent} from "#/utils/session-agent";
import {$Typed, RichText} from "@atproto/api";
import {ATProtoStrongRef} from "#/lib/types";
import {Image} from "#/lex-api/types/app/bsky/embed/images";
import {uploadImageBlob} from "#/services/blob";
import {CAHandler} from "#/utils/handler";
import {View as ExternalEmbedView} from "#/lex-server/types/app/bsky/embed/external"
import {Main as EmbedRecord} from "#/lex-server/types/app/bsky/embed/record"
import {Main as EmbedRecordWithMedia} from "#/lex-server/types/app/bsky/embed/recordWithMedia"
import {Main as Visualization} from "#/lex-server/types/ar/cabildoabierto/embed/visualization"
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post"

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


async function externalEmbedViewToMain(agent: SessionAgent, embed: ExternalEmbedView){
    const external = embed.external
    if(external.thumb){
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
        if(!post.quotedPost){
            return imagesEmbed
        } else {
            return getRecordWithMedia(post.quotedPost, imagesEmbed)
        }
    } else if(post.externalEmbedView) {
        const externalEmbed = await externalEmbedViewToMain(agent, post.externalEmbedView)
        if(!post.quotedPost){
            return externalEmbed
        } else {
            return getRecordWithMedia(post.quotedPost, externalEmbed)
        }
    } else if(post.quotedPost){
        return createQuotePostEmbed(post.quotedPost)
    } else if(post.visualization){
        return {
            ...post.visualization,
            $type: "ar.cabildoabierto.embed.visualization"
        }
    }
    return undefined
}

export async function createPostAT({
                                       agent,
                                       post
                                   }: {
    agent: SessionAgent
    post: CreatePostProps
}): Promise<{ ref: ATProtoStrongRef, record: PostRecord }> {
    const rt = new RichText({
        text: post.text
    })
    await rt.detectFacets(agent.bsky)

    const embed = await getPostEmbed(agent, post)

    let record: PostRecord = {
        $type: "app.bsky.feed.post",
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
        reply: post.reply,
        embed,
        labels: post.enDiscusion ? {$type: "com.atproto.label.defs#selfLabels", values: [{val: "ca:en discusión"}]} : undefined
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
}


export const createPost: CAHandler<CreatePostProps, ATProtoStrongRef> = async (ctx, agent, post) => {
    const {ref, record} = await createPostAT({agent, post})

    await processPost(ctx, ref, record)

    return {data: ref}
}