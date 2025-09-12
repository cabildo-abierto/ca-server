import {AppContext} from "#/setup";
import {CommitEvent, JetstreamEvent} from "#/lib/types";
import {getCollectionFromUri, getUri, isCAProfile} from "#/utils/uri";
import {getRecordProcessor} from "#/services/sync/event-processing/get-record-processor";
import {getDeleteProcessor} from "#/services/sync/event-processing/get-delete-processor";



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
    e: JetstreamEvent


    constructor(ctx: AppContext, e: JetstreamEvent) {
        this.ctx = ctx
        this.e = e
    }

    async process() {

    }
}


class CommitEventProcessor extends EventProcessor {
    c: CommitEvent
    uri: string

    constructor(ctx: AppContext, e: JetstreamEvent){
        super(ctx, e)
        const c = e as CommitEvent
        this.c = c
        this.uri = c.commit.uri ? c.commit.uri : getUri(c.did, c.commit.collection, c.commit.rkey)
    }

    async process() {
        await super.process()
        const c = this.c
        if (isCAProfile(c.commit.collection) && c.commit.rkey == "self") {
            await newUser(this.ctx, c.did, true)
        }
    }
}


class CommitCreateOrUpdateEventProcessor extends CommitEventProcessor {
    async process() {
        await super.process()
        const c = this.c

        const ref = {uri: this.uri, cid: c.commit.cid}

        const recordProcessor = getRecordProcessor(this.ctx, c.commit.collection)
        await recordProcessor.process([{ref, record: c.commit.record}])
    }
}


class CommitDeleteEventProcessor extends CommitEventProcessor {
    async process() {
        await super.process()
        const uri = this.uri
        const c = getCollectionFromUri(uri)

        await getDeleteProcessor(this.ctx, c)
            .process([uri])
    }
}


export function getProcessorForEvent(ctx: AppContext, e: JetstreamEvent) {
    if(e.kind == "commit"){
        const c = e as CommitEvent

        if(c.commit.operation == "create" || c.commit.operation == "update"){
            return new CommitCreateOrUpdateEventProcessor(ctx, e)
        } else if(c.commit.operation == "delete") {
            return new CommitDeleteEventProcessor(ctx, e)
        } else {
            return new EventProcessor(ctx, e)
        }

    } else {
        return new EventProcessor(ctx, e)
    }
}



