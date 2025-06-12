import {AppContext} from "#/index";
import {ATProtoStrongRef} from "#/lib/types";
import {CAHandler} from "#/utils/handler";
import {getCollectionFromUri, getUri} from "#/utils/uri";
import {
    processDelete, processReaction
} from "#/services/sync/process-event";
import {Record as LikeRecord} from "#/lex-api/types/app/bsky/feed/like";
import {Record as RepostRecord} from "#/lex-api/types/app/bsky/feed/repost";
import {Record as VoteAcceptRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/voteAccept";
import {Record as VoteRejectRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject";
import {
    PrismaTransactionClient,
    SyncUpdate
} from "#/services/sync/sync-update";
import {SessionAgent} from "#/utils/session-agent";
import {$Typed} from "@atproto/api";
import {createVoteAcceptAT, createVoteRejectAT, VoteRejectProps} from "#/services/wiki/votes";
import {deleteRecordAT} from "#/services/delete";


export type ReactionType =
    "app.bsky.feed.like"
    | "app.bsky.feed.repost"
    | "ar.cabildoabierto.wiki.voteAccept"
    | "ar.cabildoabierto.wiki.voteReject"


export type ReactionRecord =
    $Typed<LikeRecord>
    | $Typed<RepostRecord>
    | $Typed<VoteAcceptRecord>
    | $Typed<VoteRejectRecord>


const addReactionAT = async (agent: SessionAgent, ref: ATProtoStrongRef, type: ReactionType, voteRejectProps?: VoteRejectProps): Promise<ATProtoStrongRef> => {
    if (type == "app.bsky.feed.like") {
        return await agent.bsky.like(ref.uri, ref.cid)
    } else if (type == "ar.cabildoabierto.wiki.voteAccept") {
        return await createVoteAcceptAT(agent, ref)
    } else if (type == "ar.cabildoabierto.wiki.voteReject") {
        return await createVoteRejectAT(agent, ref, voteRejectProps)
    } else if (type == "app.bsky.feed.repost") {
        return await agent.bsky.repost(ref.uri, ref.cid)
    } else {
        throw Error(`Reacción desconocida: ${type}`)
    }
}


export const addReaction = async (ctx: AppContext, agent: SessionAgent, ref: ATProtoStrongRef, type: ReactionType, voteRejectProps?: VoteRejectProps): Promise<{
    data?: { uri: string },
    error?: string
}> => {
    try {
        const res = await addReactionAT(agent, ref, type, voteRejectProps)

        const record: ReactionRecord = {
            $type: type,
            subject: ref,
            createdAt: new Date().toISOString()
        }

        await processReaction(ctx, res, record)

        return {data: {uri: res.uri}}
    } catch (err) {
        console.error("Error giving like", err)
        return {error: "No se pudo agregar el like."}
    }
}


export const addLike: CAHandler<ATProtoStrongRef, { uri: string }> = async (ctx, agent, ref) => {
    return await addReaction(ctx, agent, ref, "app.bsky.feed.like")
}


export const repost: CAHandler<ATProtoStrongRef, { uri: string }> = async (ctx, agent, ref) => {
    return await addReaction(ctx, agent, ref, "app.bsky.feed.repost")
}


export async function incrementReactionCounter(db: PrismaTransactionClient, type: ReactionType, subjectId: string) {
    if (type == "app.bsky.feed.like") {
        return db.record.update({
            data: {uniqueLikesCount: {increment: 1}},
            where: {uri: subjectId}
        })
    } else if (type == "app.bsky.feed.repost") {
        return db.record.update({
            data: {uniqueRepostsCount: {increment: 1}},
            where: {uri: subjectId}
        })
    } else if (type == "ar.cabildoabierto.wiki.voteAccept") {
        return db.record.update({
            data: {uniqueAcceptsCount: {increment: 1}},
            where: {uri: subjectId}
        })
    } else if (type == "ar.cabildoabierto.wiki.voteReject") {
        return db.record.update({
            data: {uniqueRejectsCount: {increment: 1}},
            where: {uri: subjectId}
        })
    } else {
        throw Error("Reacción desconocida: " + type)
    }
}


export async function decrementReactionCounter(db: PrismaTransactionClient, type: ReactionType, subjectId: string) {
    if (type == "app.bsky.feed.like") {
        return db.record.update({
            data: {uniqueLikesCount: {decrement: 1}},
            where: {uri: subjectId}
        })
    } else if (type == "app.bsky.feed.repost") {
        return db.record.update({
            data: {uniqueRepostsCount: {decrement: 1}},
            where: {uri: subjectId}
        })
    } else if (type == "ar.cabildoabierto.wiki.voteAccept") {
        return db.record.update({
            data: {uniqueAcceptsCount: {decrement: 1}},
            where: {uri: subjectId}
        })
    } else if (type == "ar.cabildoabierto.wiki.voteReject") {
        return db.record.update({
            data: {uniqueRejectsCount: {decrement: 1}},
            where: {uri: subjectId}
        })
    } else {
        throw Error("Reacción desconocida: " + type)
    }
}


export const removeReactionAT = async (ctx: AppContext, agent: SessionAgent, uri: string) => {
    const collection = getCollectionFromUri(uri)
    if (collection == "app.bsky.feed.like") {
        await agent.bsky.deleteLike(uri)
    } else if (collection == "app.bsky.feed.repost") {
        await agent.bsky.deleteRepost(uri)
    } else if (collection == "ar.cabildoabierto.wiki.voteAccept") {
        await deleteRecordAT(agent, uri)
    } else if (collection == "ar.cabildoabierto.wiki.voteReject") {
        await deleteRecordAT(agent, uri)
    }
    await processDelete(ctx, uri)
    return {data: {}}
}


type RemoveReactionProps = {
    params: {
        did: string
        collection: string
        rkey: string
    }
}


export const removeLike: CAHandler<RemoveReactionProps> = async (ctx, agent, {params}) => {
    const {rkey} = params
    const uri = getUri(agent.did, "app.bsky.feed.like", rkey)
    return await removeReactionAT(ctx, agent, uri)
}


export const removeRepost: CAHandler<RemoveReactionProps> = async (ctx, agent, {params}) => {
    const {rkey} = params
    const uri = getUri(agent.did, "app.bsky.feed.repost", rkey)
    return await removeReactionAT(ctx, agent, uri)
}










