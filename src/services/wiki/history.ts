import {CAHandlerNoAuth} from "#/utils/handler.js"
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js"
import {Agent} from "#/utils/session-agent.js"
import {CategoryVotes, TopicHistory, TopicVersionStatus, VersionInHistory} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js"
import {getCollectionFromUri, getDidFromUri} from "#/utils/uri.js"
import {editorStatusToEn} from "#/services/wiki/topics.js"
import {AppContext} from "#/setup.js";
import {jsonArrayFrom} from "kysely/helpers/postgres";
import {isVersionAccepted} from "#/services/wiki/current-version.js";
import {EditorStatus} from "@prisma/client";
import {Dataplane} from "#/services/hydration/dataplane.js";
import {hydrateProfileViewBasic} from "#/services/hydration/profile.js";


export function getTopicVersionViewer(reactions: {uri: string}[]): VersionInHistory["viewer"] {
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


export function getTopicVersionStatus(authorStatus: EditorStatus, protection: EditorStatus, v: {uniqueAcceptsCount: number, uniqueRejectsCount: number}) {
    const voteCounts: CategoryVotes[] = [
        {
            accepts: v.uniqueAcceptsCount,
            rejects: v.uniqueRejectsCount,
            category: "Beginner" // TO DO (!)
        }
    ]

    const status: TopicVersionStatus = {
        voteCounts,
        accepted: isVersionAccepted(
            authorStatus,
            protection,
            voteCounts
        )
    }

    return status
}


export async function getTopicHistory(ctx: AppContext, id: string, agent?: Agent) {
    const did = agent?.hasSession() ? agent.did : null

    const versions = await ctx.kysely
        .selectFrom("TopicVersion")
        .innerJoin("Record", "Record.uri", "TopicVersion.uri")
        .innerJoin("Content", "Content.uri", "TopicVersion.uri")
        .innerJoin("Topic", "Topic.id", "TopicVersion.topicId")
        .select([
            "Record.uri",
            "Record.cid",
            "Record.created_at",
            "Record.created_at_tz",
            "uniqueAcceptsCount",
            "uniqueRejectsCount",
            "diff",
            "charsAdded",
            "charsDeleted",
            "contribution",
            "Topic.protection",
            "message",
            "accCharsAdded",
            "props",
            "prevAcceptedUri",
            "authorship",
            eb => jsonArrayFrom(eb
                .selectFrom("Reaction")
                .innerJoin("Record as ReactionRecord", "Record.uri", "Reaction.subjectId")
                .select([
                    "Reaction.uri"
                ])
                .whereRef("Reaction.subjectId", "=", "TopicVersion.uri")
                .where("ReactionRecord.authorId", "=", did ?? "no did")
            ).as("reactions"),
            eb => eb
                .selectFrom("Post as Reply")
                .select(eb => eb.fn.count<number>("Reply.uri").as("count"))
                .whereRef("Reply.replyToId", "=", "Record.uri").as("replyCount")
        ])
        .where("Record.cid", "is not", null)
        .where("Record.record", "is not", null)
        .where("TopicVersion.topicId", "=", id)
        .orderBy("created_at asc")
        .execute()

    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchProfileViewBasicHydrationData(versions.map(v => getDidFromUri(v.uri)))

    const topicHistory: TopicHistory = {
        id,
        versions: versions.map(v => {
            if (!v.cid) return null

            const viewer = getTopicVersionViewer(
                v.reactions
            )
            const author = hydrateProfileViewBasic(ctx, getDidFromUri(v.uri), dataplane) // TO DO: Usar el dataplane
            if (!author) return null

            const status = getTopicVersionStatus(editorStatusToEn(author.editorStatus), v.protection, v)

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
                createdAt: v.created_at_tz ? v.created_at_tz.toISOString() : v.created_at.toISOString(),
                contribution,
                prevAccepted: v.prevAcceptedUri ?? undefined,
                claimsAuthorship: v.authorship ?? false,
                replyCount: v.replyCount ?? 0
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