import {
    processCreateBatch, processDeleteBatch
} from "./process-batch";
import {getUserMirrorStatus, setMirrorStatus} from "./mirror-status";
import {AppContext} from "#/index";
import {getCAUsersDids} from "#/services/user/users";
import {JetstreamEvent, UserRepo, UserRepoElement} from "#/lib/types";
import {iterateAtpRepo} from "@atcute/car"
import {getServiceEndpointForDid} from "#/services/blob";
import {getCollectionFromUri, shortCollectionToCollection} from "#/utils/uri";
import {CAHandler} from "#/utils/handler";
import {processCommitEvent} from "#/services/sync/process-event";
import {logTimes} from "#/utils/utils";


export async function syncAllUsers(ctx: AppContext, mustUpdateCollections?: string[]) {
    let users = await getCAUsersDids(ctx)

    console.log("Syncing", users.length, "users")

    for (let i = 0; i < users.length; i++) {
        console.log("Syncing user", i + 1, "of", users.length, `(did: ${users[i]})`)
        await syncUser(ctx, users[i], mustUpdateCollections)
    }
}


export async function getCAUsersAndFollows(ctx: AppContext) {
    return await ctx.kysely
        .selectFrom("User")
        .innerJoin("Follow", "User.did", "Follow.userFollowedId")
        .innerJoin("Record", "Record.uri", "Follow.uri")
        .innerJoin("User as Follower", "Follower.did", "Record.authorId")
        .where("Follower.inCA", "=", true)
        .select(["User.did", "User.mirrorStatus"])
        .distinct()
        .execute()
}


export async function syncAllUsersAndFollows(ctx: AppContext, mustUpdateCollections?: string[], retries: number = 100, ignoreStatus = true) {
    const users = await getCAUsersAndFollows(ctx)

    console.log("Se obtuvieron", users.length, "usuarios")
    const pending = users.filter(u => u.mirrorStatus != "Sync")
    console.log(`Están pendientes: ${pending.length}`)

    const toSync = ignoreStatus || mustUpdateCollections?.length ? users : pending

    for (let i = 0; i < toSync.length; i++) {
        console.log("Syncing user", i + 1, "of", toSync.length, `(did: ${users[i].did})`)
        await syncUser(ctx, toSync[i].did, mustUpdateCollections)
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


async function getPendingEvents(ctx: AppContext, did: string): Promise<JetstreamEvent[]> {
    const redis = ctx.ioredis
    const key = pendingSyncEventsKey(ctx, did)

    const res = await redis
        .multi()
        .lrange(key, 0, -1)
        .del(key)
        .exec()

    if(!res) return []

    const items = res[0]

    return (items[1] as string[]).map(item => {
        try {
            return JSON.parse(item) as JetstreamEvent
        } catch (err) {
            ctx.logger?.warn({ err, item }, 'Failed to parse pending event')
            return null
        }
    }).filter((x): x is JetstreamEvent => x !== null)
}


function pendingSyncEventsKey(ctx: AppContext, did: string) {
    return `${ctx.mirrorId}:pending-sync-events:${did}`
}


export async function addPendingEvent(ctx: AppContext, did: string, e: JetstreamEvent) {
    const key = pendingSyncEventsKey(ctx, did)
    await ctx.ioredis.rpush(key, JSON.stringify(e))
}


async function isCAUser(ctx: AppContext, did: string) {
    const res = await ctx.kysely
        .selectFrom("User")
        .select("inCA")
        .where("did", "=", did)
        .executeTakeFirst()
    return !!(res && res.inCA)
}


export async function syncUser(ctx: AppContext, did: string, collections?: string[]) {
    console.log(`Syncing user: ${did} ***************`)
    const t1 = Date.now()
    const inCA = await isCAUser(ctx, did)
    console.log(`${did} inCA:`, inCA)

    const mirrorStatus = await getUserMirrorStatus(ctx, did, inCA)
    if(mirrorStatus != "InProcess") {
        console.log(`Mirror status of ${did} is not InProcess: ${mirrorStatus}. Not syncing.`)
        return
    }

    collections = collections ? collections.map(shortCollectionToCollection) : []

    console.log("Collections to sync:", collections)

    const doc = await getServiceEndpointForDid(did)

    console.log(`Downloading repo ${did}...`)
    const t2 = Date.now()
    let repo = await getUserRepo(did, doc)

    if (!repo) {
        console.log("Couldn't fetch repo from " + did)
        await setMirrorStatus(ctx, did, "Failed", inCA)
        return
    }
    console.log(`Got ${did} repo after`, Date.now()-t2)

    await processRepo(ctx, repo, did, collections)

    while(true){
        const pending = await getPendingEvents(ctx, did)
        console.log(`Processing ${pending.length} pending events from ${did}`)
        if(pending.length == 0) break
        for(let i = 0; i < pending.length; i++) {
            const e = pending[i]
            if(e.kind == "commit"){
                await processCommitEvent(ctx, e)
            }
        }
    }

    await setMirrorStatus(ctx, did, "Sync", inCA)
    console.log("Finished syncing user", did, "after", Date.now()-t1)
}


const allCollections = [
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
]


export async function processCreateBatchInBatches(ctx: AppContext, records: UserRepoElement[], collection: string) {
    const batchSize = 1000
    const batches = []
    for (let i = 0; i < records.length; i += batchSize) {
        batches.push(records.slice(i, i + batchSize))
    }
    for (let i = 0; i < batches.length; i++) {
        if(batches.length > 1){
            console.log(`${collection}: processing batch ${i + 1} of ${batches.length} (bs = ${batchSize})`)
        }
        const t1 = Date.now()
        await processCreateBatch(ctx, batches[i], collection)
        const t2 = Date.now()
        console.log(`processed batch in ${t2-t1}ms`)
    }
}


export async function processRepo(ctx: AppContext, repo: UserRepo, did: string, collections: string[] = []) {
    const t1 = Date.now()
    const {reqUpdate, recordsReqUpdate, recordsNotPresent} = await checkUpdateRequired(
        ctx,
        repo,
        did,
        collections,
    )
    const t2 = Date.now()
    console.log(`Repo has ${repo.length} records.`)
    console.log(`Requires update: ${reqUpdate}. Records to update: ${recordsReqUpdate ? recordsReqUpdate.size : 0}.`)

    if (!reqUpdate) {
        return
    }

    const recordsByCollection = new Map<string, UserRepoElement[]>()

    for (let i = 0; i < repo.length; i++) {
        if (recordsReqUpdate.has(repo[i].uri)) {
            const c = getCollectionFromUri(repo[i].uri)
            const cur = recordsByCollection.get(c)
            if(!cur){
                recordsByCollection.set(c, [repo[i]])
            } else {
                cur.push(repo[i])
            }
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
    const t3 = Date.now()

    console.log(`Deleting ${recordsNotPresent.size} records not present in repo.`)
    await processDeleteBatch(ctx, Array.from(recordsNotPresent))
    const t4 = Date.now()
    logTimes(`process repo ${did}`, [t1, t2, t3, t4])
}


export async function checkUpdateRequired(ctx: AppContext, repo: UserRepo, did: string, collections: string[]) {
    if(collections.length == 0) collections = allCollections

    console.log("checking update required for collections", collections)

    const dbRecords = (await ctx.db.record.findMany({
        select: {
            uri: true,
            cid: true,
        },
        where: {
            authorId: did,
            collection: {
                in: collections
            }
        }
    }))

    const filteredRepo = repo
        .filter(r => collections.includes(getCollectionFromUri(r.uri)))

    let reqUpdate = false

    // Mapa de uris en cids en el repo
    const repoCids: Map<string, string> = new Map(filteredRepo.map(r => [r.uri, r.cid]))

    // Mapa de uris en cids en la DB
    const dbCids: Map<string, string | null> = new Map(dbRecords.map(r => [r.uri, r.cid]))

    const recordsReqUpdate = new Set<string>()

    const recordsNotPresent = new Set<string>()

    // Iteramos los records de la DB. Si alguno no está en el repo o está y su cid no coincide, require actualización
    dbRecords.forEach((r, i) => {
        const inRepo = repoCids.has(r.uri)
        if(!inRepo){
            recordsNotPresent.add(r.uri)
        }
        if (!inRepo || repoCids.get(r.uri) != r.cid) {
            reqUpdate = true
            if (repoCids.get(r.uri) != r.cid) {
                recordsReqUpdate.add(r.uri)
            }
        }
    })

    // Iteramos los records del repo. Si alguno no está en la db o está y su cid no coincide o tiene una colección que estamos actualizando, require actualización
    filteredRepo.forEach((r, i) => {
        const c = getCollectionFromUri(r.uri)
        if (!dbCids.has(r.uri) || dbCids.get(r.uri) != r.cid) {
            reqUpdate = true
            recordsReqUpdate.add(r.uri)
        }
    })

    return {reqUpdate, recordsReqUpdate, recordsNotPresent}
}


export const syncUserHandler: CAHandler<{
    params: { handleOrDid: string },
    query: { c: string[] | string | undefined }
}, {}> = async (ctx, agent, {params, query}) => {
    const {handleOrDid} = params
    const {c} = query

    await ctx.worker?.addJob("sync-user", {
        handleOrDid,
        collectionsMustUpdate: c ? (typeof c == "string" ? [c] : c) : undefined
    })

    return {data: {}}
}


export const syncAllUsersHandler: CAHandler<{
    query: { c: string | string[] | undefined }
}, {}> = async (ctx, agent, {query}) => {
    const data = {collectionsMustUpdate: query.c ? (typeof query.c == "string" ? [query.c] : query.c) : []}
    await ctx.worker?.addJob("sync-all-users", data)
    console.log("Added sync all users to queue with data", data)
    return {data: {}}
}