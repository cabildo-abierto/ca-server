import {CAHandler} from "#/utils/handler";
import {getDidFromUri, getUri, isTopicVersion} from "#/utils/uri";
import {getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";


export type ReadChunk = {
    chunk: number
    duration: number
}

export type ReadChunks = ReadChunk[]

export type ReadChunksAttr = {
    chunks: ReadChunks,
    totalChunks: number
}

export const storeReadSession: CAHandler<{
    chunks: ReadChunks
    totalChunks: number
    params: { did: string, collection: string, rkey: string }
}> = async (ctx, agent, params) => {
    const {did, collection, rkey} = params.params;
    const uri = getUri(did, collection, rkey);

    let topicId: string | null = null
    if(isTopicVersion(collection)){
        topicId = await getTopicIdFromTopicVersionUri(ctx, did, rkey)
    }

    try {
        await ctx.db.readSession.create({
            data: {
                userId: agent.did,
                readContentId: uri,
                readChunks: {
                    chunks: params.chunks,
                    totalChunks: params.totalChunks
                },
                contentAuthorId: getDidFromUri(uri),
                topicId: topicId ?? undefined
            }
        })
    } catch {
        return {error: "Ocurrió un error al actualizar la base de datos."}
    }
    return {data: {}}
}