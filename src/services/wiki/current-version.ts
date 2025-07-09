import {max} from "#/utils/arrays";
import {AppContext} from "#/index";
import {TopicProp, TopicVersionStatus} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {PrismaTransactionClient, SyncUpdate} from "#/services/sync/sync-update";
import {getDidFromUri, getRkeyFromUri, getUri} from "#/utils/uri";
import {addUpdateContributionsJobForTopics} from "#/services/sync/process-batch";
import {CAHandlerNoAuth} from "#/utils/handler";
import {getTopicTitle} from "#/services/wiki/utils";
import {getTopicHistory} from "#/services/wiki/history";


export function getTopicLastEditFromVersions(topic: { versions: { content: { record: { createdAt: Date } } }[] }) {
    const dates = topic.versions.map(v => v.content.record.createdAt)
    return max(dates)
}


export async function getTopicIdFromTopicVersionUri(db: PrismaTransactionClient, did: string, rkey: string) {
    const res = await db.topicVersion.findMany({
        select: {
            topicId: true
        },
        where: {
            uri: {
                in: [getUri(did, "ar.com.cabildoabierto.topic", rkey), getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey)]
            }
        }
    })
    return res && res.length > 0 ? res[0].topicId : null
}


export async function processDeleteTopicVersion(ctx: AppContext, uri: string) {
    // TO DO: Esto debería ser atómico (leer la versión actual y actualizarla)

    const id = await getTopicIdFromTopicVersionUri(ctx.db, getDidFromUri(uri), getRkeyFromUri(uri))
    if (!id) return {error: "Ocurrió un error al borrar la versión."}
    const topicHistory = await getTopicHistory(ctx.db, id)
    if (!topicHistory) return {error: "Ocurrió un error al borrar la versión."}

    const currentVersion = getTopicCurrentVersion(topicHistory.versions)
    if (currentVersion == null) return {error: "Ocurrió un error al borrar la versión."}

    const index = topicHistory.versions.findIndex(v => v.uri == uri)

    const spliced = topicHistory.versions.toSpliced(index, 1)
    const newCurrentVersionIndex = getTopicCurrentVersion(spliced)

    const currentVersionId = newCurrentVersionIndex != null ? spliced[newCurrentVersionIndex].uri : undefined

    const updates = [
        ctx.db.notification.deleteMany({where: {causedByRecordId: uri}}),
        ctx.db.notification.deleteMany({where: {causedByRecordId: uri}}),
        ctx.db.readSession.deleteMany({where: {readContentId: uri}}),
        ctx.db.hasReacted.deleteMany({where: {recordId: uri}}),
        ctx.db.voteReject.deleteMany({where: {reaction: {subjectId: uri}}}),
        ctx.db.reaction.deleteMany({where: {subjectId: uri}}),
        ctx.db.reference.deleteMany({where: {referencingContentId: uri}}),
        ctx.db.topicVersion.deleteMany({where: {uri}}),
        ctx.db.content.deleteMany({where: {uri}}),
        ctx.db.record.deleteMany({where: {uri}}),
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

    const su = new SyncUpdate(ctx.db)
    su.addUpdatesAsTransaction(updates)
    console.log("applying transaction")
    await su.apply()

    console.log("udpating topic contr")
    await addUpdateContributionsJobForTopics(ctx, [id])

    return {}
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

    const ids = updates.map(({id}) => id);
    const lastEdits = updates.map(({lastEdit}) => lastEdit);

    const query = `
        UPDATE "Topic"
        SET "lastEdit" = CASE
            ${updates.map((_, i) => `WHEN "id" = $${i * 2 + 2} THEN $${i * 2 + 1}`).join(" ")}
            END
        WHERE "id" IN (${ids.map((_, i) => `$${i * 2 + 2}`).join(", ")});
    `;

    await ctx.db.$executeRawUnsafe(query, ...lastEdits.flatMap((date, i) => [date, ids[i]]));
}


export function isVersionMonetized(version: any) {
    return true // TO DO
}


export function isVersionAccepted(status?: TopicVersionStatus) {
    if (!status) return true

    function catToNumber(cat: string) {
        return 0 // TO DO
    }

    const relevantVotes = max(status.voteCounts, x => catToNumber(x.category))

    if (relevantVotes == undefined) return true

    return relevantVotes.rejects == 0 // TO DO: && relevantVotes.accepts > 0
}


export function getTopicCurrentVersion(versions: { status?: TopicVersionStatus }[]): number | null {
    for (let i = versions.length - 1; i >= 0; i--) {
        if (isVersionAccepted(versions[i].status)) {
            return i
        }
    }
    return null
}


export async function updateTopicCurrentVersion(db: PrismaTransactionClient, id: string) {
    const topicHistory = await getTopicHistory(db, id)

    const currentVersion = getTopicCurrentVersion(topicHistory.versions)

    const uri = currentVersion != null ? topicHistory.versions[currentVersion].uri : null

    await db.topic.update({
        data: {
            currentVersionId: uri
        },
        where: {
            id
        }
    })

    return {}
}


// TO DO: Estaría bueno cachear esto...
export const getTopicTitleHandler: CAHandlerNoAuth<{ params: { id: string } }, {
    title: string
}> = async (ctx, agent, {params}) => {
    const topic = await ctx.db.topic.findUnique({
        select: {
            id: true,
            currentVersion: {
                select: {
                    props: true
                }
            }
        },
        where: {
            id: params.id,
        }
    })
    if(!topic) {
        return {error: "No se encontró el tema"}
    }
    return {
        data: {
            title: getTopicTitle({id: topic.id, props: topic.currentVersion?.props as TopicProp[] | undefined})
        }
    }
}



