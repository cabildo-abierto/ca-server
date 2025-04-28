import {deleteRecords} from "../delete";
import {processCreateRecord} from "../sync/process-event";
import {updateTopicCurrentVersion} from "./current-version";
import {ATProtoStrongRef} from "#/lib/types";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {getCollectionFromUri, getRkeyFromUri} from "#/utils/uri";

export async function acceptEdit(ctx: AppContext, agent: SessionAgent, topicId: string, versionRef: ATProtoStrongRef): Promise<{error?: string}>{

    const [rejects, _] = await Promise.all([
        ctx.db.topicReject.findMany({
            select: {
                uri: true
            },
            where: {
                rejectedRecordId: versionRef.uri,
                record: {
                    authorId: agent.did
                }
            }
        }),
        createTopicVote(ctx, agent, topicId, versionRef, "accept")
    ])

    if(rejects.length > 0){
        await deleteRecords({ctx, agent, uris: rejects.map(a => a.uri), atproto: true})
    }

    await updateTopicCurrentVersion(ctx, agent, topicId)

    return {}
}

export async function createTopicVote(ctx: AppContext, agent: SessionAgent, topicId: string, versionRef: ATProtoStrongRef, value: string): Promise<{error?: string}>{

    const record = {
        $type: "ar.com.cabildoabierto.topic.vote",
        createdAt: new Date().toISOString(),
        value,
        subject: versionRef
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        record,
        collection: "ar.com.cabildoabierto.topic.vote",
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

export async function cancelAcceptEdit(ctx: AppContext, agent: SessionAgent, topicId: string, uri: string): Promise<{error?: string}>{
    return await deleteRecords({ctx, agent, uris: [uri], atproto: true})
}

export async function rejectEdit(ctx: AppContext, agent: SessionAgent, topicId: string, versionRef: ATProtoStrongRef): Promise<{error?: string}>{

    const [accepts, _] = await Promise.all([
        ctx.db.topicAccept.findMany({
            select: {
                uri: true
            },
            where: {
                acceptedRecordId: versionRef.uri,
                record: {
                    authorId: agent.did
                }
            }
        }),
        createTopicVote(ctx, agent, topicId, versionRef, "reject")
    ])

    if(accepts.length > 0){
        await deleteRecords({ctx, agent, uris: accepts.map(a => a.uri), atproto: true})
    }

    await updateTopicCurrentVersion(ctx, agent, topicId)

    return {}
}

export async function cancelRejectEdit(ctx: AppContext, agent: SessionAgent, topicId: string, uri: string): Promise<{error?: string}>{
    return await deleteRecords({ctx, agent, uris: [uri], atproto: true})
}

