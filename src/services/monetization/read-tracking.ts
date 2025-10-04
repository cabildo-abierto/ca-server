import {CAHandlerNoAuth} from "#/utils/handler";
import {getDidFromUri, getUri, isTopicVersion, splitUri} from "#/utils/uri";
import {getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";
import {v4 as uuidv4} from "uuid";
import {AppContext} from "#/setup";
import {Agent} from "#/utils/session-agent";

export type ReadChunk = {
    chunk: number
    duration: number
}

export type ReadChunks = ReadChunk[]

export type ReadChunksAttr = {
    chunks: ReadChunks,
    totalChunks: number
}

export const storeReadSessionHandler: CAHandlerNoAuth<{
    chunks: ReadChunks
    totalChunks: number
    params: { did: string, collection: string, rkey: string }
}> = async (ctx, agent, params) => {
    const {did, collection, rkey} = params.params;
    const uri = getUri(did, collection, rkey);

    const {error} =  await storeReadSession(ctx, agent, {
        contentUri: uri,
        chunks: params.chunks,
        totalChunks: params.totalChunks
    }, new Date())
    if(error) return {error}
    return {data: {}}
}


export type ReadSession = {
    contentUri: string
    chunks: ReadChunks
    totalChunks: number
}


export async function storeReadSession(ctx: AppContext, agent: Agent, readSession: ReadSession, created_at: Date) {
    const {did, collection, rkey} = splitUri(readSession.contentUri)

    let topicId: string | null = null
    if(isTopicVersion(collection)){
        topicId = await getTopicIdFromTopicVersionUri(ctx, did, rkey)
    }

    const id = uuidv4()

    try {
        await ctx.kysely
            .insertInto("ReadSession")
            .values([
                {
                    id,
                    readChunks: {
                        chunks: readSession.chunks,
                        totalChunks: readSession.totalChunks
                    },
                    userId: agent.hasSession() ? agent.did : "anonymous",
                    readContentId: readSession.contentUri,
                    contentAuthorId: getDidFromUri(readSession.contentUri),
                    topicId: topicId ?? undefined,
                    created_at,
                    created_at_tz: created_at
                }
            ])
            .execute()

    } catch {
        return {error: "Ocurrió un error al actualizar la base de datos."}
    }
    return {id}
}