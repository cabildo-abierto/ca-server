"use server"

import {DidResolver} from "@atproto/identity";
import {syncUser} from "./sync-user";
import {validRecord} from "./utils";
import {getUserMirrorStatus} from "./mirror-status";
import {
    newUser,
    processArticle,
    processDataBlock,
    processDataset,
    processFollow,
    processLike,
    processPost, processRecord,
    processRepost,
    processTopic, processTopicVote,
    processVisualization
} from "./record-processing";
import {ATProtoStrongRef, CommitEvent, JetstreamEvent, SyncRecordProps} from "#/lib/types";
import {AppContext} from "#/index";
import {getUri, splitUri} from "#/utils/uri";
import {deleteRecords} from "#/services/delete";


export async function processEvent(ctx: AppContext, e: JetstreamEvent){
    if(e.kind == "commit"){
        const c = e as CommitEvent

        if(c.commit.collection == "ar.com.cabildoabierto.profile" && c.commit.rkey == "self"){
            await newUser(ctx, e.did, true)
            const status = await getUserMirrorStatus(ctx, e.did)

            if(status == "Dirty" || status == "Failed"){
                await syncUser(ctx, e.did)
            }
            return
        }
    }

    if(e.kind == "commit") {
        const c = e as CommitEvent

        const uri = c.commit.uri ? c.commit.uri : "at://" + c.did + "/" + c.commit.collection + "/" + c.commit.rkey
        if (c.commit.operation == "create") {
            const record = {
                did: c.did,
                uri: uri,
                cid: c.commit.cid,
                collection: c.commit.collection,
                rkey: c.commit.rkey,
                record: c.commit.record
            }

            if (!validRecord(record)) {
                console.log("Invalid record")
                console.log(record)
                return
            }

            const {updates, tags} = await processCreateRecord(ctx, record)
            await ctx.db.$transaction(updates)
            // await revalidateTags(Array.from(tags))
        } else if (c.commit.operation == "delete") {
            await processDelete(ctx, {
                did: c.did,
                collection: c.commit.collection,
                rkey: c.commit.rkey
            })
        }
    }
}


export async function processCreateRecordFromRefAndRecord(ctx: AppContext, ref: ATProtoStrongRef, record: any){
    return await processCreateRecord(ctx, {
        ...ref,
        ...splitUri(ref.uri),
        record
    })
}


export type RecordProcessor = (ctx: AppContext, r: SyncRecordProps) => (any[] | Promise<any[]>)


const recordProcessors = new Map<string, RecordProcessor>([
    ["app.bsky.graph.follow", processFollow],
    ["app.bsky.feed.like", processLike],
    ["app.bsky.feed.repost", processRepost],
    ["app.bsky.feed.post", processPost],
    ["ar.cabildoabierto.feed.article", processArticle],
    ["ar.cabildoabierto.actor.profile", processCAProfile],
    ["app.bsky.actor.profile", processATProfile],
    ["ar.cabildoabierto.data.dataset", processDataset],
    ["ar.cabildoabierto.data.dataBlock", processDataBlock],
    ["ar.cabildoabierto.data.visualization", processVisualization],
    ["ar.cabildoabierto.wiki.topicVersion", processTopic],
    ["ar.cabildoabierto.wiki.vote", processTopicVote]
])


export async function processCreateRecord(ctx: AppContext, r: SyncRecordProps): Promise<{updates: any[], tags: Set<string>}> {
    console.log("processing create record", r)
    let updates = processRecord(ctx, r)
    const processor = recordProcessors.get(r.collection)
    try {
        if(processor){
            updates = [...updates, ...await processor(ctx, r)]
            return {updates, tags: new Set<string>()}
        } else {
            console.log("Couldn't find processor for collection", r.collection)
            return {updates: [], tags: new Set<string>()}
        }
    } catch (err) {
        console.log("Error processing record", r)
        console.log(err)
        return {updates: [], tags: new Set<string>()}
    }
}


function avatarUrl(did: string, cid: string){
    return "https://cdn.bsky.app/img/avatar/plain/"+did+"/"+cid+"@jpeg"
}

function bannerUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/banner/plain/"+did+"/"+cid+"@jpeg"
}


function processCAProfile(ctx: AppContext, r: SyncRecordProps){
    return [
        ctx.db.user.update({
            data: {
                CAProfileUri: r.uri,
                inCA: true
            },
            where: {
                did: r.did
            }
        })
    ]
}


export async function processATProfile(ctx: AppContext, r: SyncRecordProps){
    const avatarCid = r.record.avatar ? r.record.avatar.ref.$link : undefined
    const avatar = avatarCid ? avatarUrl(r.did, avatarCid) : undefined
    const bannerCid = r.record.banner ? r.record.banner.ref.$link : undefined
    const banner = bannerCid ? bannerUrl(r.did, bannerCid) : undefined

    const didres = new DidResolver({})
    const data = await didres.resolveAtprotoData(r.did)

    // TO DO: Tal vez no actualizar esto acá y sincronizar directo
    return [
        ctx.db.user.update({
            data: {
                description: r.record.description ? r.record.description : undefined,
                displayName: r.record.displayName ? r.record.displayName : undefined,
                avatar,
                banner,
                handle: data.handle
            },
            where: {
                did: r.did
            }
        })
    ]
}



export async function processDelete(ctx: AppContext, r: {did: string, collection: string, rkey: string}){
    await deleteRecords({ctx, uris: [getUri(r.did, r.collection, r.rkey)], atproto: false})
}