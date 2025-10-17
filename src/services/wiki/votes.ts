import {ATProtoStrongRef} from "#/lib/types.js";
import {BaseAgent, SessionAgent} from "#/utils/session-agent.js";
import {AppContext} from "#/setup.js";
import {getCollectionFromUri, getDidFromUri, getUri} from "#/utils/uri.js";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler.js";
import {addReaction, removeReactionAT} from "#/services/reactions/reactions.js";
import {Record as VoteAcceptRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/voteAccept.js"
import {Record as VoteRejectRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject.js"
import {ArCabildoabiertoWikiDefs} from "#/lex-api/index.js"
import {Dataplane} from "#/services/hydration/dataplane.js";
import {hydrateProfileViewBasic} from "#/services/hydration/profile.js";

export type TopicVoteType = "ar.cabildoabierto.wiki.voteAccept" | "ar.cabildoabierto.wiki.voteReject"

export function isTopicVote(collection: string): collection is TopicVoteType {
    return collection == "ar.cabildoabierto.wiki.voteAccept" || collection == "ar.cabildoabierto.wiki.voteReject"
}


export const createVoteAcceptAT = async (agent: SessionAgent, ref: ATProtoStrongRef): Promise<ATProtoStrongRef> => {
    const record: VoteAcceptRecord = {
        $type: "ar.cabildoabierto.wiki.voteAccept",
        createdAt: new Date().toISOString(),
        subject: ref
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        record,
        collection: "ar.cabildoabierto.wiki.voteAccept",
        repo: agent.did
    })

    return {uri: data.uri, cid: data.cid}
}


export const createVoteRejectAT = async (agent: SessionAgent, ref: ATProtoStrongRef, voteRejectProps?: VoteRejectProps): Promise<ATProtoStrongRef> => {
    const record: VoteRejectRecord = {
        $type: "ar.cabildoabierto.wiki.voteReject",
        createdAt: new Date().toISOString(),
        subject: ref,
        ...voteRejectProps
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        record,
        collection: "ar.cabildoabierto.wiki.voteReject",
        repo: agent.did
    })

    return {uri: data.uri, cid: data.cid}
}


export type VoteRejectProps = {
    message?: string,
    labels?: string[]
}


export const voteEdit: CAHandler<{
    message?: string,
    labels?: string[],
    params: { vote: string, rkey: string, did: string, cid: string }
}, { uri: string }> = async (
    ctx: AppContext, agent: SessionAgent, {message, labels, params}) => {
    const {vote, rkey, did, cid} = params

    if (vote !== "accept" && vote !== "reject") {
        return {error: `Voto inválido: ${vote}.`}
    }

    if (vote == "accept" && (message != null || labels != null)) {
        return {error: "Por ahora no se permiten etiquetas ni mensajes en un voto positivo."}
    }

    const uri = getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey)
    const versionRef = {uri, cid}

    const type: TopicVoteType = vote == "accept" ? "ar.cabildoabierto.wiki.voteAccept" : "ar.cabildoabierto.wiki.voteReject"

    const rejectProps = {message, labels}

    return await addReaction(ctx, agent, versionRef, type, rejectProps)
    // TO DO: Eliminar reacciones opuestas
}

export const cancelEditVote: CAHandler<{
    params: { collection: string, rkey: string }
}> = async (ctx: AppContext, agent: SessionAgent, {params}) => {
    const {collection, rkey} = params
    const uri = getUri(agent.did, collection, rkey)
    return await removeReactionAT(ctx, agent, uri)
}


export async function getTopicVersionVotes(ctx: AppContext, agent: BaseAgent, uri: string) {
    const reactions = await ctx.kysely
        .selectFrom("Reaction")
        .innerJoin("Record", "Record.uri", "Reaction.uri")
        .where("Reaction.subjectId","=", uri)
        .where("Record.collection", "in", [
            "ar.cabildoabierto.wiki.voteAccept",
            "ar.cabildoabierto.wiki.voteReject"
        ])
        .select([
            "Reaction.uri",
            "Record.cid",
            "Reaction.subjectId",
            "Reaction.subjectCid"
        ])
        .orderBy("Record.authorId")
        .orderBy("Record.created_at_tz asc")
        .distinctOn("Record.authorId")
        .execute()

    ctx.logger.pino.info({uri, reactions}, "getting topic version votes")

    const votes = reactions
        .filter(r => isTopicVote(getCollectionFromUri(r.uri)))
        .map(r => r.cid && r.subjectCid && r.subjectId ? {...r, subjectId: r.subjectId, subjectCid: r.subjectCid, cid: r.cid} : null)
        .filter(r => r != null)
    ctx.logger.pino.info({votes}, "votes")

    const users = votes.map(v => getDidFromUri(v.uri))
    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchProfileViewBasicHydrationData(users)
    ctx.logger.pino.info( "fetched voters")

    const voteViews: (ArCabildoabiertoWikiDefs.VoteView | null)[] = votes.map(v => {
        const author = hydrateProfileViewBasic(ctx, getDidFromUri(v.uri), dataplane)
        if(!author) {
            ctx.logger.pino.warn({uri: v.uri}, "author of vote not found")
            return null
        }
        return {
            $type: "ar.cabildoabierto.wiki.defs#voteView",
            uri: v.uri,
            cid: v.cid,
            subject: {
                uri: v.subjectId,
                cid: v.subjectCid
            },
            author
        }
    })

    ctx.logger.pino.info({voteViews}, "vote views")

    const res = voteViews.filter(v => v != null)

    ctx.logger.pino.info({res}, "retrning votes")
    return res
}


export const getTopicVersionVotesHandler: CAHandlerNoAuth<{params: {did: string, rkey: string}}, ArCabildoabiertoWikiDefs.VoteView[]> = async (ctx, agent, {params}) => {
    const uri = getUri(params.did, "ar.cabildoabierto.wiki.topicVersion", params.rkey)
    const votes = await getTopicVersionVotes(ctx, agent, uri)

    return {data: votes}
}