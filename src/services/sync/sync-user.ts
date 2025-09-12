import {AppContext} from "#/setup";
import {getCAUsersDids, handleToDid} from "#/services/user/users";
import {JetstreamEvent} from "#/lib/types";
import {iterateAtpRepo} from "@atcute/car"
import {getServiceEndpointForDid} from "#/services/blob";
import {getCollectionFromUri, shortCollectionToCollection} from "#/utils/uri";
import {CAHandler} from "#/utils/handler";
import {logTimes} from "#/utils/utils";
import {getProcessorForEvent} from "#/services/sync/event-processing/event-processor";
import {batchDeleteRecords, getRecordProcessor} from "#/services/sync/event-processing/get-record-processor";


export async function syncAllUsers(ctx: AppContext, mustUpdateCollections?: string[]) {
    let users = await getCAUsersDids(ctx)

    for (let i = 0; i < users.length; i++) {
        console.log("Syncing user", i + 1, "of", users.length, `(did: ${users[i]})`)
        await ctx.redisCache.mirrorStatus.set(users[i], "InProcess", true)
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
        .select(["User.did"])
        .distinct()
        .execute()
}


export async function getUserRepo(did: string, doc: string, collections: string[]): Promise<{repo?: any[], error?: string}> {
    const url = doc + "/xrpc/com.atproto.sync.getRepo?did=" + did
    console.log(`fetching ${did} repo from`, url)
    const res = await fetch(url)
    console.log("got repo", did)

    const collectionsSet = new Set(collections)

    if (res.ok) {
        const arrayBuffer = await res.arrayBuffer()
        const mb = 1000000
        if(arrayBuffer.byteLength > 50 * mb){
            console.log(`${did} repo is too large: ${arrayBuffer.byteLength / mb}mbs.`)
            return {error: "too large"}
        }

        const ui8 = new Uint8Array(arrayBuffer)
        const repo = []
        for (const {collection, rkey, record, cid} of iterateAtpRepo(ui8)) {
            const uri = "at://" + did + "/" + collection + "/" + rkey
            if(collectionsSet.has(collection)){
                repo.push({did, collection, rkey, record, cid: cid.$link, uri: uri})
            }
        }
        return {repo}
    }
    console.log(`fetch error for repo ${did}`)
    return {error: "fetch error"}
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

    const mirrorStatus = await ctx.redisCache.mirrorStatus.get(did, inCA)
    if(mirrorStatus != "InProcess") {
        console.log(`Mirror status of ${did} is not InProcess: ${mirrorStatus}. Not syncing.`)
        return
    }

    collections = collections ? collections.map(shortCollectionToCollection) : []

    console.log("Collections to sync:", collections)

    const doc = await getServiceEndpointForDid(did)
    if (typeof doc != "string") {
        await ctx.redisCache.mirrorStatus.set(did, "Failed", inCA)
        return
    }

    await processRepo(ctx, doc, did, collections, inCA)

    while(true){
        const pending = await getPendingEvents(ctx, did)
        console.log(`Processing ${pending.length} pending events from ${did}`)
        if(pending.length == 0) break
        for(let i = 0; i < pending.length; i++) {
            const e = pending[i]
            if(e.kind == "commit"){
                await getProcessorForEvent(ctx, e).process()
            }
        }
    }
    await ctx.redisCache.mirrorStatus.set(did, "Sync", inCA)
    console.log("Finished syncing user", did, "after", Date.now()-t1)
}


export const allCollections = [
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

export type UserRepo = UserRepoElement[]

export type UserRepoElement = {
    did: string
    uri: string
    collection: string
    rkey: string
    record: any
    cid: string
}

export async function processRepo(ctx: AppContext, doc: string, did: string, collections: string[] = [], inCA: boolean) {
    const t1 = Date.now()
    if(collections.length == 0) collections = allCollections

    console.log(`Downloading repo ${did}...`)
    let {repo, error} = await getUserRepo(did, doc, collections)

    if (!repo) {
        if(error && error == "too large"){
            await ctx.redisCache.mirrorStatus.set(did, "Failed - Too Large", inCA)
        } else {
            await ctx.redisCache.mirrorStatus.set(did, "Failed", inCA)
        }
        return
    }

    const {reqUpdate, recordsReqUpdate, recordsNotPresent} = await checkUpdateRequired(
        ctx,
        repo,
        did,
        collections,
    )
    const t2 = Date.now()
    console.log(`Requires update: ${reqUpdate}. Records to update: ${recordsReqUpdate ? recordsReqUpdate.size : 0}.`)

    if (!reqUpdate) {
        return
    }

    const repoReqUpdate = repo.filter(r => recordsReqUpdate.has(r.uri))

    for (let i = 0; i < collections.length; i++) {
        const collection = collections[i]
        const records: UserRepoElement[] = repoReqUpdate.filter(r => r.collection == collection)

        console.log(`*** Processing collection ${collection} (${records.length} records).`)
        const t1 = Date.now()
        await getRecordProcessor(ctx, collection)
            .processInBatches(records.map(r => ({ref: {uri: r.uri, cid: r.cid}, record: r.record})))
        console.log(`${collection} done after ${Date.now() - t1} ms.`)
    }
    const t3 = Date.now()

    console.log(`Deleting ${recordsNotPresent.size} records not present in repo.`)

    await batchDeleteRecords(ctx, Array.from(recordsNotPresent))
    const t4 = Date.now()
    logTimes(`process repo ${did}`, [t1, t2, t3, t4])
}


export async function checkUpdateRequired(ctx: AppContext, repo: UserRepo, did: string, collections: string[]) {
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
            },
            record: {
                not: null
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
    dbRecords.forEach(r => {
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

    const did = await handleToDid(ctx, agent, handleOrDid)
    if(!did) return {error: "No se pudo obtener el did."}

    const inCA = await isCAUser(ctx, did)

    await ctx.redisCache.mirrorStatus.set(did, "InProcess", inCA)

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


export async function updateRecordsCreatedAt(ctx: AppContext) {
    let offset = 0
    const bs = 10000
    while(true){
        console.log("updating records created at batch", offset)

        const t1 = Date.now()
        const res = await ctx.kysely
            .selectFrom("Record")
            .select([
                "uri",
                "record"
            ])
            .limit(bs)
            .offset(offset)
            .orderBy("uri desc")
            .execute()
        const t2 = Date.now()

        const values: {uri: string, created_at: Date}[] = []
        res.forEach(r => {
            if(r.record){
                const record = JSON.parse(r.record)
                if(record.created_at){
                    values.push({
                        uri: r.uri,
                        created_at: record.created_at
                    })
                }
            }
        })

        console.log(`got ${res.length} results and ${values.length} values to update`)
        if(values.length > 0){
            await ctx.kysely
                .insertInto("Record")
                .values(values.map(v => ({
                    ...v,
                    collection: "",
                    rkey: "",
                    authorId: ""
                })))
                .onConflict(oc => oc.column("uri").doUpdateSet(eb => ({
                    created_at: eb.ref("excluded.created_at")
                })))
                .execute()
        }
        const t3 = Date.now()
        logTimes("batch done in", [t1, t2, t3])

        offset += bs
        if(res.length < bs) break
    }
}