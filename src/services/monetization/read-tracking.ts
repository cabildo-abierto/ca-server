import {CAHandler} from "#/utils/handler";
import {getUri} from "#/utils/uri";

type ReadChunks = {
    chunk: number
    duration: number
}[]

export const storeReadSession: CAHandler<{
    chunks: ReadChunks
    totalChunks: number
    params: { did: string, collection: string, rkey: string }
}, {}> = async (ctx, agent, params) => {
    const {did, collection, rkey} = params.params;
    const uri = getUri(did, collection, rkey);

    try {
        await ctx.db.readSession.create({
            data: {
                userId: agent.did,
                readContentId: uri,
                readChunks: {
                    chunks: params.chunks,
                    totalChunks: params.totalChunks
                }
            }
        })
    } catch (err) {
        return {error: "Ocurrió un error al actualizar la base de datos."}
    }
    return {data: {}}
}