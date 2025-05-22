import {
    processCreateBatch, processDeleteBatch
} from "./process-batch";
import {deleteRecords} from "../delete";
import {getDirtyUsers, setMirrorStatus} from "./mirror-status";
import {AppContext} from "#/index";
import {getCAUsersDids} from "#/services/user/users";
import {UserRepo, UserRepoElement} from "#/lib/types";
import {iterateAtpRepo} from "@atcute/car"
import {getServiceEndpointForDid} from "#/services/blob";
import {getCollectionFromUri, shortCollectionToCollection} from "#/utils/uri";
import {CAHandler} from "#/utils/handler";
import {processDelete} from "#/services/sync/process-event";


export async function restartSync(ctx: AppContext): Promise<void> {
    await ctx.db.user.updateMany({
        data: {
            mirrorStatus: "Dirty"
        }
    })
}


export async function syncAllUsers(ctx: AppContext, mustUpdateCollections?: string[], retries: number = 100, ignoreStatus: boolean = true) {
    let users: string[]
    if (ignoreStatus) {
        users = await getCAUsersDids(ctx)
    } else {
        users = await getDirtyUsers(ctx)
    }

    console.log("Syncing", users.length, "users")

    for (let i = 0; i < users.length; i++) {
        console.log("Syncing user", i + 1, "of", users.length, `(did: ${users[i]})`)
        await syncUser(ctx, users[i], mustUpdateCollections, retries)
    }
}


function parseCar(did: string, buf: ArrayBuffer): UserRepo {
    const ui8 = new Uint8Array(buf);
    const repo = []
    for (const {collection, rkey, record, cid} of iterateAtpRepo(ui8)) {
        const uri = "at://" + did + "/" + collection + "/" + rkey
        repo.push({did, collection, rkey, record, cid: cid.$link, uri: uri})
    }
    return repo
}


export async function getUserRepo(did: string, doc: string | Record<string, unknown> | null) {
    if (typeof doc != "string") return null
    const url = doc + "/xrpc/com.atproto.sync.getRepo?did=" + did
    const res = await fetch(url)
    if (res.ok) {
        const arrayBuffer = await res.arrayBuffer()
        return parseCar(did, arrayBuffer)
    }
    return null
}


export async function syncUser(ctx: AppContext, did: string, collectionsMustUpdate?: string[], retries: number = 100) {
    console.log(`Syncing user: ${did} ***************`)
    collectionsMustUpdate = collectionsMustUpdate ? collectionsMustUpdate.map(shortCollectionToCollection) : []

    if(collectionsMustUpdate.length > 0) console.log("Must update", collectionsMustUpdate)

    const [_, doc] = await Promise.all([
        ctx.db.user.update({
            data: {
                mirrorStatus: "InProcess"
            },
            where: {
                did: did
            }
        }),
        getServiceEndpointForDid(did)
    ])
    // revalidateTag("mirrorStatus:"+did)

    let repo = await getUserRepo(did, doc)

    if (!repo) {
        console.log("Couldn't fetch repo from " + did)
        await ctx.db.user.update({
            data: {
                mirrorStatus: "Failed"
            },
            where: {
                did: did
            }
        })
        return
    }

    await processRepo(ctx, repo, did, collectionsMustUpdate, retries)

    /*
    TO DO: Procesar eventos pendientes
    while(!state.pending.isEmpty()){
        const e = state.pending.shift()
        if(!e) break
        await processEvent(e)
        if(e.kind == "commit"){
            presentRecords.add((e as CommitEvent).commit.uri)
        }
    }*/

    const records = await ctx.db.record.findMany({
        select: {
            uri: true,
        },
        where: {
            authorId: did
        }
    })

    const presentRecords = new Set()
    repo.forEach((r) => {
        presentRecords.add(r.uri)
    })
    const urisNotPresent: string[] = records.map(({uri}) => uri).filter(uri => !presentRecords.has(uri))

    if(urisNotPresent.length > 0){
        console.log(`Deleting records not present (${urisNotPresent.length})`)
        await processDeleteBatch(ctx, urisNotPresent)
    }

    await setMirrorStatus(ctx, did, "Sync")
    console.log(`Done syncing user: ${did} *********************`)
}


export function collectionOfInterest(collection: string) {
    return [
        "app.bsky.feed.post",
        "app.bsky.feed.like",
        "app.bsky.feed.repost",
        "app.bsky.graph.follow",
        "app.bsky.actor.profile",
        "ar.cabildoabierto.feed.article",
        "ar.cabildoabierto.wiki.topicVersion",
        "ar.cabildoabierto.data.dataset",
        "ar.cabildoabierto.wiki.voteAccept",
        "ar.cabildoabierto.wiki.voteReject",
        "ar.cabildoabierto.actor.caProfile",
        "ar.com.cabildoabierto.profile"
    ].includes(collection)
}


export async function processCreateBatchInBatches(ctx: AppContext, records: UserRepoElement[], collection: string) {
    const batchSize = 500
    const batches = []
    for (let i = 0; i < records.length; i += batchSize) {
        batches.push(records.slice(i, i + batchSize))
    }
    for (let i = 0; i < batches.length; i++) {
        if(batches.length > 1){
            console.log(`Processing batch ${i + 1} of ${batches.length} (bs = ${batchSize})`)
        }
        await processCreateBatch(ctx, batches[i], collection)
    }
}


export async function processRepo(ctx: AppContext, repo: UserRepo, did: string, collectionsMustUpdate: string[] = [], retries: number = 100) {
    const {reqUpdate, recordsReqUpdate} = await checkUpdateRequired(ctx, repo, did, collectionsMustUpdate)

    console.log(`Repo has ${repo.length} records.`)
    console.log(`Requires update: ${reqUpdate}. Records to update: ${recordsReqUpdate ? recordsReqUpdate.size : 0}.`)

    if (!reqUpdate) {
        return
    }

    const recordsByCollection = new Map<string, UserRepoElement[]>()

    for (let i = 0; i < repo.length; i++) {
        if (recordsReqUpdate.has(repo[i].uri)) {
            const c = getCollectionFromUri(repo[i].uri)
            recordsByCollection.set(c, [...(recordsByCollection.get(c) ?? []), repo[i]])
        }
    }

    const entries = Array.from(recordsByCollection.entries())

    for (let i = 0; i < entries.length; i++) {
        const [collection, records] = entries[i]

        console.log(`*** Processing collection ${collection} (${records.length} records).`)
        const t1 = Date.now()
        await processCreateBatchInBatches(ctx, records, collection)
        console.log(`${collection} done after ${Date.now() - t1} ms.`)
    }
}


export async function checkUpdateRequired(ctx: AppContext, repo: UserRepo, did: string, collectionsMustUpdate: string[] = []) {
    // Obtenemos todos los records del usuario en la DB
    const dbRecords = (await ctx.db.record.findMany({
        select: {
            uri: true,
            cid: true,
        },
        where: {
            authorId: did
        }
    })).filter(r => collectionOfInterest(getCollectionFromUri(r.uri)))

    const filteredRepo = repo.filter(r => collectionOfInterest(getCollectionFromUri(r.uri)))

    let reqUpdate = false

    // Mapa de uris en cids en el repo
    const repoCids: Map<string, string> = new Map(filteredRepo.map(r => [r.uri, r.cid]))

    // Mapa de uris en cids en la DB
    const dbCids: Map<string, string | null> = new Map(dbRecords.map(r => [r.uri, r.cid]))

    const recordsReqUpdate = new Set<string>()

    // Iteramos los records de la DB. Si alguno no está en el repo o está y su cid no coincide, require actualización
    dbRecords.forEach((r, i) => {
        if (!repoCids.has(r.uri) || repoCids.get(r.uri) != r.cid) {
            reqUpdate = true
            if (repoCids.get(r.uri) != r.cid) {
                recordsReqUpdate.add(r.uri)
            }
        }
    })

    // Iteramos los records del repo. Si alguno no está ne la db o está y su cid no coincide o tiene una colección que estamos actualizando, require actualización
    filteredRepo.forEach((r, i) => {
        const c = getCollectionFromUri(r.uri)
        if (!dbCids.has(r.uri) || dbCids.get(r.uri) != r.cid || collectionsMustUpdate.includes(c)) {
            reqUpdate = true
            recordsReqUpdate.add(r.uri)
        }
    })

    return {reqUpdate, recordsReqUpdate}
}


export const syncUserHandler: CAHandler<{
    params: { handleOrDid: string },
    query: { c: string[] | string | undefined }
}, {}> = async (ctx, agent, {params, query}) => {
    const {handleOrDid} = params
    const {c} = query

    await ctx.queue.add("sync-user", {
        handleOrDid,
        collectionsMustUpdate: c ? (typeof c == "string" ? [c] : c) : undefined
    })

    return {data: {}}
}


export const syncAllUsersHandler: CAHandler<{
    query: { c: string | string[] | undefined }
}, {}> = async (ctx, agent, {query}) => {
    const data = {collectionsMustUpdate: query.c ? (typeof query.c == "string" ? [query.c] : query.c) : []}
    await ctx.queue.add("sync-all-users", data)
    console.log("Added sync all users to queue with data", data)
    return {data: {}}
}