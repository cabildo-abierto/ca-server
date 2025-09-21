import {getCollectionFromUri, getRkeyFromUri, getUri} from "#/utils/uri";
import {AppContext} from "#/setup";
import {SessionAgent} from "#/utils/session-agent";
import {CAHandler} from "#/utils/handler";
import {handleToDid} from "#/services/user/users";
import {getDeleteProcessor} from "#/services/sync/event-processing/get-delete-processor";
import {batchDeleteRecords} from "#/services/sync/event-processing/get-record-processor";


export async function deleteRecordsForAuthor({ctx, agent, author, collections, atproto}: {ctx: AppContext, agent?: SessionAgent, author: string, collections?: string[], atproto: boolean}){
    const uris = (await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            OR: [
                {
                    author: {
                        did: author
                    }
                },
                {
                    author: {
                        handle: author
                    }
                }
            ],
            collection: collections ? {
                in: collections
            } : undefined
        }
    })).map((r) => (r.uri))

    return await deleteRecords({ctx, agent, uris, atproto})
}


export const deleteRecordsHandler: CAHandler<{uris: string[], atproto: boolean}> = async (ctx, agent, {uris, atproto}) => {
    return await deleteRecords({ctx, agent, uris, atproto})
}


export const deleteCollectionHandler: CAHandler<{params: {collection: string}}, {}> = async (ctx, agent, {params}) => {
    const {collection} = params
    await ctx.worker?.addJob("delete-collection", {collection})
    return {data: {}}
}


export async function deleteCollection(ctx: AppContext, collection: string){
    const uris = (await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            collection: collection
        }
    })).map((r) => (r.uri))
    await getDeleteProcessor(ctx, collection).process(uris)
}


export async function deleteRecords({ctx, agent, uris, atproto}: { ctx: AppContext, agent?: SessionAgent, uris: string[], atproto: boolean }): Promise<{error?: string}> {
    if (atproto && agent) {
        for (let i = 0; i < uris.length; i++) {
            await deleteRecordAT(agent, uris[i])
        }
    }

    await batchDeleteRecords(ctx, uris)

    return {}
}


export const deleteUserHandler: CAHandler<{params: {handleOrDid: string}}> = async (ctx, agent, {params}) => {
    const {handleOrDid} = params
    const did = await handleToDid(ctx, agent, handleOrDid)
    if(!did) return {error: "No se pudo resolver el handle."}
    await deleteUser(ctx, did)
    return {data: {}}
}


export async function deleteUser(ctx: AppContext, did: string) {
    await deleteRecordsForAuthor({ctx, author: did, atproto: false})

    await ctx.db.$transaction([
        ctx.db.blob.deleteMany({
            where: {
                authorId: did
            }
        }),
        ctx.db.user.deleteMany({
            where: {
                did: did
            }
        })
    ])
    // TO DO: Revisar que cache hace falta actualizar
}


export const deleteCAProfile: CAHandler<{}, {}> = async (ctx, agent, {}) => {
    console.log("Deleting CA profile of did:", agent.did)
    const res1 = await agent.bsky.com.atproto.repo.deleteRecord({
        rkey: "self",
        collection: "ar.com.cabildoabierto.profile",
        repo: agent.did
    })
    console.log("Commit 1:", res1.data.commit)
    const res2 = await agent.bsky.com.atproto.repo.deleteRecord({
        rkey: "self",
        collection: "ar.cabildoabierto.actor.caProfile",
        repo: agent.did
    })
    console.log("Commit 2:", res2.data.commit)
    return {}
}


export async function deleteRecordAT(agent: SessionAgent, uri: string){
    try {
        await agent.bsky.com.atproto.repo.deleteRecord({
            repo: agent.did,
            rkey: getRkeyFromUri(uri),
            collection: getCollectionFromUri(uri)
        })
    } catch {
        console.warn("No se pudo borrar de ATProto", uri)
    }
}


export const deleteRecordHandler: CAHandler<{params: {rkey: string, collection: string}}> = async (ctx, agent, {params}) => {
    const {rkey, collection} = params
    const uri = getUri(agent.did, collection, rkey)
    await deleteRecordAT(agent, uri)
    await getDeleteProcessor(ctx, collection).process([uri])
    return {data: {}}
}
