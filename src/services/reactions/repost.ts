import {AppContext} from "#/index";
import {createRecord} from "#/services/user/users";
import {ATProtoStrongRef} from "#/lib/types";
import {CAHandler} from "#/utils/handler";

export async function createRepostDB({ctx, uri, cid, repostedUri}: {ctx: AppContext, uri: string, cid: string, repostedUri: string}): Promise<void> {
    const updates= [
        ...createRecord({ctx, uri, cid, createdAt: new Date(), collection: "app.bsky.feed.repost"}),
        ctx.db.repost.create({
            data: {
                uri: uri,
                repostedRecordId: repostedUri
            }
        })
    ]

    await ctx.db.$transaction(updates)

    // await revalidateUri(repostedUri)
}


export async function deleteRepostDB(ctx: AppContext, uri: string, repostedUri: string){
    const updates = [
        ctx.db.repost.delete({
            where: {
                uri: uri
            }
        }),
        ctx.db.record.delete({
            where: {
                uri: uri
            }
        })
    ]

    await ctx.db.$transaction(updates)

    // await revalidateUri(repostedUri)
}


export const repost: CAHandler<ATProtoStrongRef, {uri: string}> = async (ctx, agent, ref) => {
    try {
        const res = await agent.bsky.repost(ref.uri, ref.cid)
        await createRepostDB({ctx, ...res, repostedUri: ref.uri})
        return {data: {uri: res.uri}}
    } catch(err) {
        console.error("Error reposting", err)
        console.error("uri", ref.uri)
        return {error: "No se pudo agregar el like."}
    }
}


export type RemoveRepostProps = {
    uri: string
    repostedUri: string
}


export const removeRepost: CAHandler<RemoveRepostProps> = async (ctx, agent, {uri, repostedUri}) => {
    try {
        await agent.bsky.deleteRepost(uri)
        await deleteRepostDB(ctx, uri, repostedUri)
        return {data: {}}
    } catch(err) {
        console.error("Error eliminando el repost", err)
        return {error: "No se pudo eliminar la republicación."}
    }
}