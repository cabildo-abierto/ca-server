import {ATProtoStrongRef} from "#/lib/types.js";
import {SessionAgent} from "#/utils/session-agent.js";
import {AppContext} from "#/setup.js";
import {getUri} from "#/utils/uri.js";
import {CAHandler} from "#/utils/handler.js";
import {addReaction, removeReactionAT} from "#/services/reactions/reactions.js";
import {Record as VoteAcceptRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/voteAccept.js"
import {Record as VoteRejectRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject.js"

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
