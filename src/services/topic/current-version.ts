import {getTopicHistory} from "./topics";
import {max, unique} from "#/utils/arrays";
import {AppContext} from "#/index";
import {getDidFromUri} from "#/utils/uri";
import {SessionAgent} from "#/utils/session-agent";
import {TopicVersionStatus} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";


export function getTopicLastEditFromVersions(topic: {versions: {content: {record: {createdAt: Date}}}[]}){
    const dates = topic.versions.map(v => v.content.record.createdAt)
    return max(dates)
}


export async function getTopicIdFromTopicVersionUri(ctx: AppContext, uri: string){
    const res = await ctx.db.topicVersion.findUnique({
        select: {
            topicId: true
        },
        where: {
            uri
        }
    })
    return res ? res.topicId : null
}


export async function deleteTopicVersion(ctx: AppContext, agent: SessionAgent, uri: string){
    const id = await getTopicIdFromTopicVersionUri(ctx, uri)
    if(!id) return {error: "Ocurrió un error al borrar la versión."}
    const {data: topicHistory} = await getTopicHistory(ctx, agent, {params: {id}})
    if(!topicHistory) return {error: "Ocurrió un error al borrar la versión."}

    const currentVersion = getTopicCurrentVersion(topicHistory.versions)
    if(!currentVersion) return {error: "Ocurrió un error al borrar la versión."}

    const index = topicHistory.versions.findIndex(v => v.uri == uri)

    const spliced = topicHistory.versions.toSpliced(index, 1)
    const newCurrentVersionIndex = getTopicCurrentVersion(spliced)

    const currentVersionId = newCurrentVersionIndex != null ? spliced[newCurrentVersionIndex].uri : undefined
    console.log("setting new current version", currentVersionId)

    const updates = [
        ctx.db.reference.deleteMany({where: {referencingContentId: uri}}),
        ctx.db.topicVersion.delete({where: {uri}}),
        ctx.db.content.delete({where: {uri}}),
        ctx.db.record.delete({where: {uri}}),
        ctx.db.topic.update({
            where: {
                id,
            },
            data: {
                lastEdit: new Date(),
                currentVersionId
            }
        })
    ]

    await ctx.db.$transaction(updates)

    // await revalidateRedis(ctx, ["currentVersion:"+topicVersion.id])
    // await revalidateTags(["topic:"+topic.id, "topics", ...(changedCategories ? ["categories"] : [])])
}


export async function updateTopicsLastEdit(ctx: AppContext) {
    const topics = await ctx.db.topic.findMany({
        select: {
            id: true,
            versions: {
                select: {
                    content: {
                        select: {
                            record: {
                                select: {
                                    createdAt: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    const updates = topics
        .map(t => ({
            id: t.id,
            lastEdit: getTopicLastEditFromVersions(t)
        }))
        .filter(t => t.lastEdit !== null);

    if (updates.length === 0) return;

    const ids = updates.map(({ id }) => id);
    const lastEdits = updates.map(({ lastEdit }) => lastEdit);

    const query = `
        UPDATE "Topic"
        SET "lastEdit" = CASE 
            ${updates.map((_, i) => `WHEN "id" = $${i * 2 + 2} THEN $${i * 2 + 1}`).join(" ")}
        END
        WHERE "id" IN (${ids.map((_, i) => `$${i * 2 + 2}`).join(", ")});
    `;

    await ctx.db.$executeRawUnsafe(query, ...lastEdits.flatMap((date, i) => [date, ids[i]]));
}


export function isVersionAccepted(status?: TopicVersionStatus){
    return true // TO DO
}


export function getTopicCurrentVersion(versions: {status?: TopicVersionStatus}[]): number | null {
    for(let i = versions.length-1; i >= 0; i--){
        if(isVersionAccepted(versions[i].status)){
            return i
        }
    }
    return null
}


export async function updateTopicCurrentVersion(ctx: AppContext, agent: SessionAgent, id: string){
    const {data: topic, error} = await getTopicHistory(ctx, agent, {params: {id}})

    if(!topic) return {error}

    const currentVersion = getTopicCurrentVersion(topic.versions)

    const uri = currentVersion != null ? topic.versions[currentVersion].uri : null

    await ctx.db.topic.update({
        data: {
            currentVersionId: uri
        },
        where: {
            id
        }
    })

    return {}
}


export async function updateTopicsCurrentVersion(ctx: AppContext) {
    let topics = (await ctx.db.topic.findMany({
        select: {
            id: true,
            versions: {
                select: {
                    uri: true,
                    content: {
                        select: {
                            text: true,
                            textBlob: true,
                            numWords: true,
                            record: {
                                select: {
                                    accepts: {
                                        select: {
                                            uri: true
                                        }
                                    },
                                    rejects: {
                                        select: {
                                            uri: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                },
                orderBy: {
                    content: {
                        record: {
                            createdAt: "asc"
                        }
                    }
                }
            }
        }
    })).map(t => {
        return {
            ...t,
            versions: t.versions.map(v => {
                return {
                    ...v,
                    uniqueAccepts: unique(v.content.record.accepts.map(a => getDidFromUri(a.uri))).length,
                    uniqueRejects: unique(v.content.record.rejects.map(a => getDidFromUri(a.uri))).length,
                    content: {
                        ...v.content,
                        hasText: v.content.text != null || v.content.numWords != null || v.content.textBlob != null
                    }
                }
            })
        }
    })

    throw Error("Sin implementar.")

    /*const updates = topics
        .map(t => ({
            id: t.id,
            currentVersionId: t.versions[getTopicCurrentVersion(t)]?.uri || null
        }))
        .filter(t => t.currentVersionId !== null);

    if (updates.length === 0) return;

    await ctx.db.$executeRawUnsafe(`
        UPDATE "Topic" AS t
        SET "currentVersionId" = c."uri"
        FROM (VALUES ${updates.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")}) AS c(id, uri)
        WHERE t.id = c.id;
    `, ...updates.flatMap(({ id, currentVersionId }) => [id, currentVersionId]))

     */
}



