import {processCreateRecordFromRefAndRecord} from "../sync/process-event";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post"
import {CreatePostProps} from "#/routes/post";
import {RichText} from "@atproto/api";
import {ATProtoStrongRef} from "#/lib/types";
import {Image} from "#/lex-api/types/app/bsky/embed/images";
import {uploadImageBlob} from "#/services/blob";

async function getPostEmbed(agent: SessionAgent, post: CreatePostProps): Promise<PostRecord["embed"] | undefined> {
    if(post.selection){
        return {
            $type: "ar.cabildoabierto.embed.selectionQuote",
            start: post.selection[0],
            end: post.selection[1]
        }
    } else if(post.images){
        const blobs = await Promise.all(post.images.map(image => uploadImageBlob(agent, image)))
        const imagesEmbed: Image[] = blobs.map(b => ({alt: "", image: b}))

        return {
            $type: "app.bsky.embed.images",
            images: imagesEmbed
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
}): Promise<ATProtoStrongRef> {
    const rt = new RichText({
        text: post.text
    })
    await rt.detectFacets(agent.bsky)

    const embed = await getPostEmbed(agent, post)

    let ref: {uri: string, cid: string}
    let record: PostRecord = {
        $type: "app.bsky.feed.post",
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
        reply: post.reply,
        embed
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        repo: agent.did,
        collection: record.$type,
        record
    })

    return data
}


export async function createPost({
    ctx,
    agent,
    post
}: {
    ctx: AppContext
    agent: SessionAgent
    post: CreatePostProps
}): Promise<{error?: string, ref?: {uri: string, cid: string}}> {

    const ref = await createPostAT({
        agent, post
    })

    if (ref) {
        const {updates, tags} = await processCreateRecordFromRefAndRecord(ctx, ref, post)

        await ctx.db.$transaction(updates)
        // await revalidateTags(Array.from(tags))
    }

    //if(reply){
        // revalidateTag("thread:"+getDidFromUri(reply.parent.uri)+":"+getRkeyFromUri(reply.parent.uri))
        // revalidateTag("thread:"+getDidFromUri(reply.root.uri)+":"+getRkeyFromUri(reply.root.uri))

        // revalidateTag("topic:Inflación")
    //}

    return {ref}
}