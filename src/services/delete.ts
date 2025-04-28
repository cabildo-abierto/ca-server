import {getCollectionFromUri, getRkeyFromUri, isTopicVersion} from "#/utils/uri";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {CAHandler} from "#/utils/handler";
import {deleteTopicVersion} from "#/services/topic/current-version";


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


export async function deleteRecords({ctx, agent, uris, atproto}: { ctx: AppContext, agent?: SessionAgent, uris: string[], atproto: boolean }): Promise<{error?: string}> {
    if (atproto && agent) {
        for (let i = 0; i < uris.length; i++) {
            await agent.bsky.com.atproto.repo.deleteRecord({
                repo: agent.did,
                rkey: getRkeyFromUri(uris[i]),
                collection: getCollectionFromUri(uris[i])
            })
        }
    }

    try {
        // TO DO: hacer esto por collections
        await ctx.db.$transaction([
            ctx.db.topicAccept.deleteMany({
                where: {
                    uri: {
                        in: uris
                    }
                }
            }),
            ctx.db.topicReject.deleteMany({
                where: {
                    uri: {
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
            ctx.db.like.deleteMany({
                where: {
                    uri: {
                        in: uris
                    }
                }
            }),
            ctx.db.repost.deleteMany({
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
            ctx.db.visualization.deleteMany({
                where: {
                    uri: {
                        in: uris
                    }
                }
            }),
            ctx.db.dataBlock.deleteMany({
                where: {
                    uri: {
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
    } catch (err) {
        console.error(err)
        return {error: "Error al borrar los registros."}
    }

    return {}
}


export async function deleteUser(ctx: AppContext, did: string) {
    await deleteRecordsForAuthor({ctx, author: did, atproto: false})

    await ctx.db.$transaction([
        ctx.db.blob.deleteMany({
            where: {
                authorId: did
            }
        }),
        ctx.db.view.deleteMany({
            where: {
                userById: did
            }
        }),
        ctx.db.view.deleteMany({
            where: {
                userById: did
            }
        }),
        ctx.db.user.deleteMany({
            where: {
                did: did
            }
        })
    ])
}


export const deleteRecord: CAHandler<{uri: string}> = async (ctx, agent, {uri}) => {
    const c = getCollectionFromUri(uri)
    if(isTopicVersion(c)){
        await deleteTopicVersion(ctx, agent, uri)
    }
    return {data: {}}
}