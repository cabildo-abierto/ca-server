import {deleteRecords} from "../delete";
import {processCreateRecord} from "../sync/process-event";
import {updateTopicCurrentVersion} from "./current-version";
import {ATProtoStrongRef} from "#/lib/types";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {getCollectionFromUri, getRkeyFromUri, getUri} from "#/utils/uri";
import {CAHandler} from "#/utils/handler";

export const voteEdit: CAHandler<{message?: string, labels?: string[], params: {id: string, vote: string, rkey: string, did: string, cid: string}}, {acceptUri: string}> = async (ctx: AppContext, agent: SessionAgent, {message, labels, params}) => {
    const {id, vote, rkey, did, cid} = params

    console.log("voting edit", vote, id, did, rkey, cid)

    if(vote !== "accept" && vote !== "reject"){
        return {error: `Voto inválido: ${vote}.`}
    }

    if(vote == "accept" && (message != null || labels != null)){
        return {error: "Por ahora no se permiten etiquetas ni mensajes en un voto positivo."}
    }

    const uri = getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey)
    const versionRef = {uri, cid}

    const [rejects, accepts, _] = await Promise.all([
        ctx.db.topicReject.findMany({
            select: {
                uri: true
            },
            where: {
                rejectedRecordId: uri,
                record: {
                    authorId: agent.did
                }
            }
        }),
        ctx.db.topicAccept.findMany({
            select: {
                uri: true
            },
            where: {
                acceptedRecordId: uri,
                record: {
                    authorId: agent.did
                }
            }
        }),
        createTopicVote(ctx, agent, id, versionRef, vote, message, labels)
    ])

    if(vote == "accept" && rejects.length > 0){
        await deleteRecords({ctx, agent, uris: rejects.map(a => a.uri), atproto: true})
    } else if(vote == "reject" && accepts.length > 0){
        await deleteRecords({ctx, agent, uris: accepts.map(a => a.uri), atproto: true})
    }

    console.log("deleted previous votes")

    await updateTopicCurrentVersion(ctx, agent, id)

    console.log("updated current version")

    return {}
}

export async function createTopicVote(ctx: AppContext, agent: SessionAgent, topicId: string, versionRef: ATProtoStrongRef, value: string, message: string | undefined, labels: string[] | undefined): Promise<{error?: string}>{

    const record = {
        $type: "ar.cabildoabierto.wiki.vote",
        createdAt: new Date().toISOString(),
        value,
        subject: versionRef,
        message: message,
        labels: labels
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        record,
        collection: "ar.cabildoabierto.wiki.vote",
        repo: agent.did
    })

    let {updates, tags} = await processCreateRecord(ctx, {
        did: agent.did,
        uri: data.uri,
        cid: data.cid,
        rkey: getRkeyFromUri(data.uri),
        collection: getCollectionFromUri(data.uri),
        record
    })

    await ctx.db.$transaction(updates)
    // await revalidateTags(Array.from(tags))

    return {}
}

export const cancelEditVote: CAHandler<{params: {id: string, rkey: string}}> = async (ctx: AppContext, agent: SessionAgent, {params}) => {
    const {id, rkey} = params
    const uri = getUri(agent.did, "ar.cabildoabierto.wiki.vote", rkey)
    return await deleteRecords({ctx, agent, uris: [uri], atproto: true})
}
