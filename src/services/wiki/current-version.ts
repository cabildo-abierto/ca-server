import {max, unique} from "#/utils/arrays";
import {TopicProp, TopicVersionStatus} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {getUri} from "#/utils/uri";
import {CAHandlerNoAuth} from "#/utils/handler";
import {getTopicTitle} from "#/services/wiki/utils";
import {AppContext} from "#/setup";
import {DB} from "../../../prisma/generated/types";
import {getTopicVersionStatusFromReactions} from "#/services/monetization/author-dashboard";
import {sql, Transaction} from "kysely";


export async function getTopicIdFromTopicVersionUri(ctx: AppContext, did: string, rkey: string) {
    const uris = [getUri(did, "ar.com.cabildoabierto.topic", rkey), getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey)]

    const res = await ctx.kysely
        .selectFrom("TopicVersion")
        .select("topicId")
        .where("uri", "in", uris)
        .execute()

    return res && res.length > 0 ? res[0].topicId : null
}


function getStatusWithAuthorVote(authorStatus: string, status?: TopicVersionStatus): TopicVersionStatus {
    if (status) {
        const idx = status.voteCounts
            .findIndex(c => c.category == authorStatus)

        if (idx != -1) {
            status.voteCounts[idx].accepts += 1
        } else {
            status.voteCounts.push({
                category: authorStatus,
                accepts: 1,
                rejects: 0
            })
        }
        return status
    } else {
        return {
            voteCounts: [{
                category: authorStatus,
                accepts: 1,
                rejects: 0
            }]
        }
    }
}


function catToNumber(cat: string) {
    const res = ["Beginner", "Editor", "Administrator"].indexOf(cat)
    const resEs = ["Editor principiante", "Editor", "Administrador"].indexOf(cat)
    if (res == -1 && resEs == -1) throw Error(`Categoría de editor desconocida: ${cat}`)
    return res != -1 ? res : resEs
}


export function isVersionAccepted(authorStatus: string, protection: string, status?: TopicVersionStatus) {
    const statusWithAuthor = getStatusWithAuthorVote(authorStatus, status)
    const relevantVotes = max(statusWithAuthor.voteCounts, x => catToNumber(x.category))
    if(!relevantVotes) throw Error("No hubo ningún voto incluyendo al autor!")
    return relevantVotes.rejects == 0 && relevantVotes.accepts > 0
}


export function getTopicCurrentVersion(protection: string = "Beginner", versions: { author: {editorStatus?: string}, status?: TopicVersionStatus }[]): number | null {
    for (let i = versions.length - 1; i >= 0; i--) {
        if (isVersionAccepted(versions[i].author.editorStatus ?? "Beginner", protection, versions[i].status)) {
            return i
        }
    }
    return null
}


// TO DO: Estaría bueno cachear esto...
export const getTopicTitleHandler: CAHandlerNoAuth<{ params: { id: string } }, {
    title: string
}> = async (ctx, agent, {params}) => {
    const topic = await ctx.kysely
        .selectFrom("Topic")
        .innerJoin("TopicVersion", "TopicVersion.uri", "Topic.currentVersionId")
        .select([
            "id",
            "props"
        ])
        .where("id", "=", params.id)
        .executeTakeFirst()

    if (!topic) {
        return {error: "No se encontró el tema"}
    }
    return {
        data: {
            title: getTopicTitle({id: topic.id, props: topic.props as TopicProp[] | undefined})
        }
    }
}


export async function updateTopicsCurrentVersionBatch(trx: Transaction<DB> | AppContext["kysely"], topicIds: string[]) {
    topicIds = unique(topicIds)
    if (topicIds.length == 0) return

    type VersionWithVotes = {
        topicId: string
        uri: string
        reactions: { uri: string, editorStatus: string }[] | null
        protection: string
        editorStatus: string
        currentVersionId: string | null
        accCharsAdded: number | null
        created_at: Date
    }

    let allVersions: VersionWithVotes[]

    try {
        allVersions = await trx
            .selectFrom('Record')
            .innerJoin('Content', 'Content.uri', 'Record.uri')
            .innerJoin('TopicVersion', 'TopicVersion.uri', 'Content.uri')
            .innerJoin("User", "Record.authorId", "User.did")
            .innerJoin("Topic", "Topic.id", "TopicVersion.topicId")
            .leftJoin("Reaction", "Reaction.subjectId", "TopicVersion.uri")
            .leftJoin("Record as ReactionRecord", "Reaction.uri", "ReactionRecord.uri")
            .leftJoin("User as ReactionAuthor", "ReactionAuthor.did", "ReactionRecord.authorId")
            .select([
                "Record.created_at",
                'TopicVersion.topicId',
                "Topic.currentVersionId",
                'Record.uri',
                "Topic.protection",
                "User.editorStatus",
                "accCharsAdded",
                eb => eb.fn.jsonAgg(
                    sql<{ uri: string; editorStatus: string }>`json_build_object
                    ('uri', "Reaction"."uri", 'editorStatus', "ReactionAuthor"."editorStatus")`
                ).filterWhere("Reaction.uri", "is not", null).as("reactions")
            ])
            .where('TopicVersion.topicId', 'in', topicIds)
            .where('Record.cid', 'is not', null)
            .groupBy([
                "Record.created_at",
                'TopicVersion.topicId',
                "Topic.currentVersionId",
                'Record.uri',
                "Topic.protection",
                "User.editorStatus",
                "accCharsAdded",
            ])
            .orderBy('Record.created_at', 'asc')
            .execute();
    } catch (err) {
        console.error("Error getting topics for update current version", err)
        return
    }

    const versionsByTopic = new Map<string, VersionWithVotes[]>()
    allVersions.forEach(version => {
        versionsByTopic.set(version.topicId, [...versionsByTopic.get(version.topicId) ?? [], version])
    })

    let lastEdit = new Date()
    let updates: {
        id: string
        currentVersionId: string | null
        lastEdit: Date
    }[] = []
    for (let i = 0; i < topicIds.length; i++) {
        const id = topicIds[i]
        const versions = versionsByTopic.get(id)
        if (!versions) continue

        if (versions.length == 0) {
            updates.push({
                id,
                currentVersionId: null,
                lastEdit
            })
        } else {
            const status = versions
                .map(v => ({
                        author: {
                            editorStatus: v.editorStatus
                        },
                        status: getTopicVersionStatusFromReactions(v.reactions ?? [])
                    })
                )

            const currentVersion = getTopicCurrentVersion(
                versions[0].protection,
                status
            )
            if (currentVersion == null) {
                updates.push({
                    id,
                    currentVersionId: null,
                    lastEdit
                })
            } else {
                const newCurrentVersion = versions[currentVersion].uri
                const currentCurrentVersion = versions[0].currentVersionId

                if (newCurrentVersion != currentCurrentVersion) {
                    updates.push({
                        id,
                        currentVersionId: newCurrentVersion,
                        lastEdit
                    })
                }
            }
        }
    }

    if (updates.length == 0) {
        return
    }

    try {
        await trx
            .insertInto("Topic")
            .values(updates)
            .onConflict((oc) =>
                oc.column("id").doUpdateSet({
                    currentVersionId: (eb) => eb.ref('excluded.currentVersionId'),
                    lastEdit: (eb) => eb.ref('excluded.lastEdit')
                })
            )
            .execute()
    } catch (err) {
        console.error("Error updating topics current version:", err)
    }
}

export async function updateAllTopicsCurrentVersions(ctx: AppContext) {
    const topics = await ctx.kysely.selectFrom("Topic").select("id").execute()

    const batchSize = 500

    for (let i = 0; i < topics.length; i += batchSize) {
        console.log("Updating all topics current version", i)
        await updateTopicsCurrentVersionBatch(
            ctx.kysely,
            topics.slice(i, i + batchSize).map(x => x.id)
        )
    }
}