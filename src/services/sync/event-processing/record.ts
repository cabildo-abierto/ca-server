import {ATProtoStrongRef} from "#/lib/types";
import {
    getCollectionFromUri,
    getDidFromUri,
    getRkeyFromUri,
    splitUri
} from "#/utils/uri";
import {Transaction} from "kysely";
import {DB} from "../../../../prisma/generated/types";

export async function processRecordsBatch(trx: Transaction<DB>, records: { ref: ATProtoStrongRef, record: any }[]) {
    const data: {
        uri: string,
        cid: string,
        rkey: string,
        collection: string,
        created_at?: Date,
        authorId: string
        record: string
        CAIndexedAt: Date
        lastUpdatedAt: Date
    }[] = []


    records.forEach(r => {
        const {ref, record} = r
        const {did, collection, rkey} = splitUri(ref.uri)
        data.push({
            uri: ref.uri,
            cid: ref.cid,
            rkey,
            collection,
            created_at: new Date(record.createdAt),
            authorId: did,
            record: JSON.stringify(record),
            CAIndexedAt: new Date(),
            lastUpdatedAt: new Date()
        })
    })

    try {
        if(data.length > 0){
            await trx
                .insertInto('Record')
                .values(data)
                .onConflict((oc) =>
                    oc.column("uri").doUpdateSet((eb) => ({
                        cid: eb.ref('excluded.cid'),
                        rkey: eb.ref('excluded.rkey'),
                        collection: eb.ref('excluded.collection'),
                        created_at: eb.ref('excluded.created_at'),
                        authorId: eb.ref('excluded.authorId'),
                        record: eb.ref('excluded.record'),
                        lastUpdatedAt: eb.ref('excluded.lastUpdatedAt') // CAIndexedAt no se actualiza
                    }))
                )
                .execute()
        }
    } catch (err) {
        console.log(err)
        console.log("Error processing records")
    }
}


export async function createUsersBatch(trx: Transaction<DB>, dids: string[]) {
    if (dids.length == 0) return
    await trx
        .insertInto("User")
        .values(dids.map(did => ({did})))
        .onConflict((oc) => oc.column("did").doNothing())
        .execute()
}


export async function processDirtyRecordsBatch(trx: Transaction<DB>, refs: ATProtoStrongRef[]) {
    if (refs.length == 0) return

    const users = refs.map(r => getDidFromUri(r.uri))
    await createUsersBatch(trx, users)

    const data = refs.map(({uri, cid}) => ({
        uri,
        rkey: getRkeyFromUri(uri),
        collection: getCollectionFromUri(uri),
        authorId: getDidFromUri(uri),
        cid,
        record: null
    }))

    if (data.length == 0) return

    await trx
        .insertInto("Record")
        .values(data)
        .onConflict((oc) => oc.column("uri").doNothing())
        .execute()
}
