import {max, unique} from "#/utils/arrays.js";
import {TopicProp, TopicVersionStatus} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js";
import {getUri} from "#/utils/uri.js";
import {CAHandlerNoAuth} from "#/utils/handler.js";
import {getTopicCategories, getTopicTitle} from "#/services/wiki/utils.js";
import {AppContext} from "#/setup.js";
import {DB} from "../../../prisma/generated/types.js";
import {getTopicVersionStatusFromReactions} from "#/services/monetization/author-dashboard.js";
import {sql, Transaction} from "kysely";
import {EditorStatus} from "@prisma/client";
import {produce} from "immer";


export async function getTopicIdFromTopicVersionUri(ctx: AppContext, did: string, rkey: string) {
    const uris = [getUri(did, "ar.com.cabildoabierto.topic", rkey), getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey)]

    const res = await ctx.kysely
        .selectFrom("TopicVersion")
        .select("topicId")
        .where("uri", "in", uris)
        .execute()

    return res && res.length > 0 ? res[0].topicId : null
}


function addAuthorVoteToVoteCounts(authorStatus: EditorStatus, voteCounts?: TopicVersionStatus["voteCounts"]): TopicVersionStatus["voteCounts"] {
    if (voteCounts) {
        return produce(voteCounts, draft => {
            const idx = voteCounts
                .findIndex(c => c.category == authorStatus)

            if (idx != -1) {
                draft[idx].accepts += 1
            } else {
                draft.push({
                    category: authorStatus,
                    accepts: 1,
                    rejects: 0
                })
            }
        })
    } else {
        return [{
            category: authorStatus,
            accepts: 1,
            rejects: 0
        }]
    }
}


function catToNumber(cat: string) {
    const res = ["Beginner", "Editor", "Administrator"].indexOf(cat)
    const resEs = ["Editor principiante", "Editor", "Administrador"].indexOf(cat)
    if (res == -1 && resEs == -1) throw Error(`Categoría de editor desconocida: ${cat}`)
    return res != -1 ? res : resEs
}


export function isVersionAccepted(
    authorStatus: EditorStatus,
    protection: EditorStatus,
    voteCounts?: TopicVersionStatus["voteCounts"]
) {
    // TO DO (!) considerar la protección
    const voteCountsWithAuthor = addAuthorVoteToVoteCounts(authorStatus, voteCounts)
    const relevantVotes = max(voteCountsWithAuthor, x => catToNumber(x.category))
    if(!relevantVotes) throw Error("No hubo ningún voto incluyendo al autor!")
    return relevantVotes.rejects == 0 && relevantVotes.accepts > 0
}


export function getTopicCurrentVersion(versions: { status: TopicVersionStatus }[]): number | null {
    for (let i = versions.length - 1; i >= 0; i--) {
        if(versions[i].status?.accepted) return i
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


export async function updateTopicsCurrentVersionBatch(ctx: AppContext, trx: Transaction<DB> | AppContext["kysely"], topicIds: string[]) {
    topicIds = unique(topicIds)
    if (topicIds.length == 0) return

    type VersionWithVotes = {
        topicId: string
        uri: string
        reactions: { uri: string, editorStatus: string }[] | null
        protection: EditorStatus
        editorStatus: EditorStatus
        currentVersionId: string | null
        accCharsAdded: number | null
        created_at: Date
        props: unknown
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
                "TopicVersion.props",
                eb => eb.fn.jsonAgg(
                    sql<{ uri: string; editorStatus: string }>`json_build_object
                    ('uri', "Reaction"."uri", 'editorStatus', "ReactionAuthor"."editorStatus")`
                ).filterWhere("Reaction.uri", "is not", null).as("reactions")
            ])
            .where('TopicVersion.topicId', 'in', topicIds)
            .where('Record.cid', 'is not', null)
            .groupBy([
                "TopicVersion.props",
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

    const categoryUpdates: {id: string, categories: string[]}[] = []

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
            const versionsStatus = versions
                .map(v => ({
                        author: {
                            editorStatus: v.editorStatus
                        },
                        status: getTopicVersionStatusFromReactions(v.reactions ?? [], v.editorStatus, v.protection)
                    })
                )

            const currentVersion = getTopicCurrentVersion(
                versionsStatus
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
                    categoryUpdates.push({
                        id,
                        categories: getTopicCategories(versions[currentVersion].props as TopicProp[])
                    })
                }
            }
        }
    }

    if (updates.length > 0) {
        try {
            await trx
                .insertInto("Topic")
                .values(updates.map(u => ({...u, synonyms: [], lastEdit_tz: u.lastEdit})))
                .onConflict((oc) =>
                    oc.column("id").doUpdateSet({
                        currentVersionId: (eb) => eb.ref('excluded.currentVersionId'),
                        lastEdit: (eb) => eb.ref('excluded.lastEdit'),
                        lastEdit_tz: (eb) => eb.ref('excluded.lastEdit_tz')
                    })
                )
                .execute()
        } catch (err) {
            ctx.logger.pino.error({error: err}, "Error updating topics current version")
        }
    }

    if(categoryUpdates.length > 0) {
        try {
            const newCategories = categoryUpdates.flatMap(u => u.categories)
            ctx.logger.pino.info({newCategories}, "new topic categories")
            if(newCategories.length > 0){
                await trx
                    .insertInto("TopicCategory")
                    .values(newCategories.map(u => ({id: u})))
                    .onConflict(
                        oc => oc
                            .column("id").doNothing())
                    .execute()
            }
            const values: {topicId: string, categoryId: string}[] = []
            categoryUpdates.forEach(c => {
                values.push(...c.categories.map(cat => ({topicId: c.id, categoryId: cat})))
            })
            await trx.deleteFrom("TopicToCategory")
                .where("topicId", "in", categoryUpdates.map(v => v.id))
                .execute()
            if(values.length > 0) {
                await trx
                    .insertInto("TopicToCategory")
                    .values(values)
                    .onConflict(oc => oc.columns(["topicId", "categoryId"]).doNothing())
                    .execute()
            }
        } catch (err) {
            ctx.logger.pino.error({error: err}, "Error updating categories with new topic current version")
        }
    }
}

export async function updateAllTopicsCurrentVersions(ctx: AppContext) {
    const topics = await ctx.kysely.selectFrom("Topic").select("id").execute()

    const batchSize = 500

    for (let i = 0; i < topics.length; i += batchSize) {
        console.log("Updating all topics current version", i)
        await ctx.kysely.transaction().execute(async trx => {
            await updateTopicsCurrentVersionBatch(
                ctx,
                trx,
                topics.slice(i, i + batchSize).map(x => x.id)
            )
        })
    }
}