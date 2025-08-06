import {getCollectionFromUri, getRkeyFromUri, getUri} from "#/utils/uri";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {CAHandler} from "#/utils/handler";
import {handleToDid} from "#/services/user/users";
import {processDelete} from "#/services/sync/process-event";
import {SyncUpdate} from "#/services/sync/sync-update";


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
    console.log(`Found ${uris.length} records. Deleting all...`)
    const su = deleteRecordsDB(ctx, uris)
    await su.apply()
    console.log("Done.")
}


export function deleteRecordsDB(ctx: AppContext, uris: string[]){
    const su = new SyncUpdate(ctx.db)
    console.log("Deleting from DB")
    su.addUpdatesAsTransaction([
        ctx.db.topicInteraction.deleteMany({
            where: {
                recordId: {
                    in: uris
                }
            }
        }),
        ctx.db.notification.deleteMany({
            where: {
                causedByRecordId: {
                    in: uris
                }
            }
        }),
        ctx.db.hasReacted.deleteMany({
            where: {
                recordId: {
                    in: uris
                }
            }
        }),
        ctx.db.readSession.deleteMany({
            where: {
                readContentId: {
                    in: uris
                }
            }
        }),
        ctx.db.reference.deleteMany({
            where: {
                referencingContentId: {
                    in: uris
                }
            }
        }),
        ctx.db.follow.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.post.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.article.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.voteReject.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.reaction.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.topicVersion.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.dataBlock.deleteMany({
            where: {
                datasetId: {
                    in: uris
                }
            }
        }),
        ctx.db.dataset.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.content.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        }),
        ctx.db.record.deleteMany({
            where: {
                uri: {
                    in: uris
                }
            }
        })
    ])
    return su
}


export async function deleteRecords({ctx, agent, uris, atproto}: { ctx: AppContext, agent?: SessionAgent, uris: string[], atproto: boolean }): Promise<{error?: string}> {
    if (atproto && agent) {
        for (let i = 0; i < uris.length; i++) {
            await deleteRecordAT(agent, uris[i])
        }
    }

    try {
        const su = deleteRecordsDB(ctx, uris)
        await su.apply()
    } catch (err) {
        console.error(err)
        return {error: "Error al borrar los registros."}
    }

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
    const {error} = await processDelete(ctx, uri)
    if(error) return {error}
    return {data: {}}
}
