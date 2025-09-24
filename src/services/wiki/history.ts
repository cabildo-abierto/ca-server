import {CAHandlerNoAuth} from "#/utils/handler"
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {Agent} from "#/utils/session-agent"
import {CategoryVotes, TopicHistory, TopicVersionStatus, VersionInHistory} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {getCollectionFromUri} from "#/utils/uri"
import {dbUserToProfileViewBasic} from "#/services/wiki/topics"
import {AppContext} from "#/setup";
import {jsonArrayFrom} from "kysely/helpers/postgres";


function getViewerForTopicVersionInHistory(reactions: {uri: string}[]): VersionInHistory["viewer"] {
    let accept: string | undefined
    let reject: string | undefined

    if (reactions) {
        reactions.forEach(a => {
            const collection = getCollectionFromUri(a.uri)
            if (collection == "ar.cabildoabierto.wiki.voteAccept") {
                accept = a.uri
            } else if (collection == "ar.cabildoabierto.wiki.voteReject") {
                reject = a.uri
            }
        })
    }
    return {
        accept, reject
    }
}


export async function getTopicHistory(ctx: AppContext, id: string, agent?: Agent) {
    const did = agent?.hasSession() ? agent.did : null

    const versions = await ctx.kysely
        .selectFrom("TopicVersion")
        .innerJoin("Record", "Record.uri", "TopicVersion.uri")
        .innerJoin("Content", "Content.uri", "TopicVersion.uri")
        .innerJoin("User", "User.did", "Record.authorId")
        .select([
            "Record.uri",
            "Record.cid",
            "Record.created_at",
            "uniqueAcceptsCount",
            "uniqueRejectsCount",
            "diff",
            "charsAdded",
            "charsDeleted",
            "contribution",
            "message",
            "accCharsAdded",
            "props",
            "prevAcceptedUri",
            "authorship",
            eb => jsonArrayFrom(eb
                .selectFrom("Reaction")
                .innerJoin("Record as ReactionRecord", "Record.uri", "Reaction.uri")
                .select([
                    "Reaction.uri"
                ])
                .whereRef("Reaction.subjectId", "=", "TopicVersion.uri")
                .where("ReactionRecord.authorId", "=", did ?? "no did")
            ).as("reactions"),
            "did",
            "handle",
            "displayName",
            "avatar",
            "CAProfileUri",
            "userValidationHash",
            "orgValidation"
        ])
        .where("Record.cid", "is not", null)
        .where("Record.record", "is not", null)
        .where("TopicVersion.topicId", "=", id)
        .orderBy("created_at asc")
        .execute()

    const topicHistory: TopicHistory = {
        id,
        versions: versions.map(v => {
            if (!v.cid) return null

            const viewer = getViewerForTopicVersionInHistory(
                v.reactions
            )

            const voteCounts: CategoryVotes[] = [
                {
                    accepts: v.uniqueAcceptsCount,
                    rejects: v.uniqueRejectsCount,
                    category: "Beginner" // TO DO
                }
            ]

            const author = dbUserToProfileViewBasic(v)
            if (!author) return null

            const status: TopicVersionStatus = {
                voteCounts
            }

            const contributionStr = v.contribution
            const contribution = contributionStr ? JSON.parse(contributionStr) : undefined

            const props = Array.isArray(v.props) ? v.props as unknown as TopicProp[] : []

            const view: VersionInHistory = {
                $type: "ar.cabildoabierto.wiki.topicVersion#versionInHistory",
                uri: v.uri,
                cid: v.cid,
                author: {
                    ...author,
                    $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
                },
                message: v.message,
                viewer,
                status: status,
                addedChars: v.charsAdded ?? undefined,
                removedChars: v.charsDeleted ?? undefined,
                props,
                createdAt: v.created_at.toISOString(),
                contribution,
                prevAccepted: v.prevAcceptedUri ?? undefined,
                claimsAuthorship: v.authorship ?? false
            }
            return view
        }).filter(v => v != null)
    }
    return topicHistory
}

export const getTopicHistoryHandler: CAHandlerNoAuth<{
    params: { id: string }
}, TopicHistory> = async (ctx, agent, {params}) => {
    const {id} = params
    try {
        const topicHistory = await getTopicHistory(ctx, id, agent)
        return {data: topicHistory}
    } catch (e) {
        console.error("Error getting topic " + id)
        console.error(e)
        return {error: "No se pudo obtener el historial."}
    }
}