import {AppContext} from "#/setup";
import {CommitEvent, JetstreamEvent} from "#/lib/types";
import {getCollectionFromUri, getUri, isCAProfile} from "#/utils/uri";
import {getRecordProcessor} from "#/services/sync/event-processing/get-record-processor";
import {getDeleteProcessor} from "#/services/sync/event-processing/get-delete-processor";
import {RefAndRecord} from "#/services/sync/types";



function newUser(ctx: AppContext, did: string, inCA: boolean) {
    if (inCA) {
        return ctx.kysely.insertInto("User")
            .values([{
                did,
                inCA: true
            }])
            .onConflict(oc => oc.column("did").doUpdateSet(eb => ({
                inCA: eb => eb.ref("excluded.inCA")
            })))
            .execute()
    } else {
        return ctx.kysely.insertInto("User")
            .values([{
                did
            }])
            .onConflict(oc => oc.column("did").doNothing())
            .execute()
    }
}

export class EventProcessor {
    ctx: AppContext

    constructor(ctx: AppContext) {
        this.ctx = ctx
    }

    async process(e: JetstreamEvent[]) {

    }
}


class CommitEventProcessor extends EventProcessor {

    constructor(ctx: AppContext){
        super(ctx)

    }

    async process(events: JetstreamEvent[]) {
        await super.process(events)

        for(let i = 0; i < events.length; i++) {
            const c = events[i] as CommitEvent
            if (isCAProfile(c.commit.collection) && c.commit.rkey == "self") {
                await newUser(this.ctx, c.did, true)
            }
        }
    }
}


class CommitCreateOrUpdateEventProcessor extends CommitEventProcessor {
    async process(events: JetstreamEvent[]) {
        await super.process(events)

        const byCollection = new Map<string, RefAndRecord[]>()
        for(const e of events) {
            const c = e as CommitEvent
            const collection = c.commit.collection
            const uri = c.commit.uri ? c.commit.uri : getUri(c.did, c.commit.collection, c.commit.rkey)
            const ref = {uri, cid: c.commit.cid}
            const refAndRecord = {ref, record: c.commit.record}

            const cur = byCollection.get(collection)
            if(!cur) {
                byCollection.set(collection, [refAndRecord])
            } else {
                cur.push(refAndRecord)
            }
        }

        for await (const [c, refAndRecords] of byCollection.entries()) {
            const recordProcessor = getRecordProcessor(this.ctx, c)
            await recordProcessor.process(refAndRecords)
        }
    }
}


class CommitDeleteEventProcessor extends CommitEventProcessor {
    async process(events: JetstreamEvent[]) {
        await super.process(events)

        const byCollection = new Map<string, string[]>()
        for(const e of events) {
            const c = e as CommitEvent
            const collection = c.commit.collection
            const uri = c.commit.uri ? c.commit.uri : getUri(c.did, c.commit.collection, c.commit.rkey)

            const cur = byCollection.get(collection)
            if(!cur) {
                byCollection.set(collection, [uri])
            } else {
                cur.push(uri)
            }
        }

        for await (const [c, uris] of byCollection.entries()) {
            const recordProcessor = getDeleteProcessor(this.ctx, c)
            await recordProcessor.process(uris)
        }
    }
}


export function getProcessorForEvent(ctx: AppContext, e: JetstreamEvent) {
    if(e.kind == "commit"){
        const c = e as CommitEvent

        if(c.commit.operation == "create" || c.commit.operation == "update"){
            return new CommitCreateOrUpdateEventProcessor(ctx)
        } else if(c.commit.operation == "delete") {
            return new CommitDeleteEventProcessor(ctx)
        } else {
            return new EventProcessor(ctx)
        }

    } else {
        return new EventProcessor(ctx)
    }
}


export async function processEventsBatch(ctx: AppContext, events: JetstreamEvent[]) {
    const createAndUpdateEvents = events.filter(e => {
        if(e.kind != "commit") return false
        const c = e as CommitEvent
        return c.commit.operation == "create" || c.commit.operation == "update"
    }) as CommitEvent[]
    const deleteEvents = events.filter(e => {
        if(e.kind != "commit") return false
        const c = e as CommitEvent
        return c.commit.operation == "delete"
    }) as CommitEvent[]

    await new CommitCreateOrUpdateEventProcessor(ctx).process(createAndUpdateEvents)
    await new CommitDeleteEventProcessor(ctx).process(deleteEvents)
}

