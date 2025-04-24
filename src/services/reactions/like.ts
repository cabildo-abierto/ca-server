import {AppContext} from "#/index";
import {ATProtoStrongRef} from "#/lib/types";
import { createRecord } from "../user/users";
import {CAHandler} from "#/utils/handler";


export async function createLikeDB({ctx, uri, cid, likedUri}: {ctx: AppContext, uri: string, cid: string, likedUri: string}): Promise<void> {
    const updates= [
        ...createRecord({ctx, uri, cid, createdAt: new Date(), collection: "app.bsky.feed.like"}),
        ctx.db.like.create({
            data: {
                uri: uri,
                likedRecordId: likedUri
            }
        })
    ]

    await ctx.db.$transaction(updates)

    // await revalidateUri(likedUri)
}


export async function deleteLikeDB(ctx: AppContext, uri: string, likedUri: string){
    const updates = [
        ctx.db.like.delete({
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

    // await revalidateUri(likedUri)
}


export const addLike: CAHandler<ATProtoStrongRef, {uri: string}> = async (ctx, agent, ref) => {
    try {
        const res = await agent.bsky.like(ref.uri, ref.cid)
        await createLikeDB({ctx, ...res, likedUri: ref.uri})
        return {uri: res.uri}
    } catch(err) {
        console.error("Error giving like", err)
        return {error: "No se pudo agregar el like."}
    }
}

export type RemoveLikeProps = {
    uri: string
    likedUri: string
}

export const removeLike: CAHandler<RemoveLikeProps> = async (ctx, agent, {uri, likedUri}) => {
    try {
        await agent.bsky.deleteLike(uri)
        await deleteLikeDB(ctx, uri, likedUri)
        return {}
    } catch(err) {
        console.error("Error removing like", err)
        return {error: "No se pudo eliminar el like."}
    }
}











