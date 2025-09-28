import {AppContext} from "#/setup";
import {getRecordProcessor} from "#/services/sync/event-processing/get-record-processor";
import {RefAndRecord} from "#/services/sync/types";


async function countCollectionRecords(ctx: AppContext, collection: string): Promise<number> {
    const res = await ctx.kysely
        .selectFrom('Record')
        .select((eb) => eb.fn.countAll<number>().as('count')) // Use countAll() for COUNT(*)
        .where('collection', '=', collection)
        .where("record", "is not", null)
        .where("cid", "is not", null)
        .executeTakeFirstOrThrow()
    return res.count
}


export async function reprocessCollection(ctx: AppContext, collection: string): Promise<void> {
    let offset = 0
    const bs = 5000

    const count = await countCollectionRecords(ctx, collection)

    ctx.logger.pino.info({collection, count}, "Reprocessing collection...")

    const processor = getRecordProcessor(ctx, collection)

    while(true) {
        const records = await ctx.kysely
            .selectFrom("Record")
            .select(["Record.uri", "Record.cid", "Record.record"])
            .where("collection", "=", collection)
            .where("Record.record", "is not", null)
            .where("Record.cid", "is not", null)
            .limit(bs)
            .offset(offset)
            .orderBy("created_at asc")
            .execute()

        ctx.logger.pino.info({offset, count: records.length, collection}, "Reprocessing collection batch")
        if(records.length == 0) break

        const refAndRecords: RefAndRecord[] = records.map(r => {
            if(r.record && r.cid) {
                return {
                    ref: {
                        uri: r.uri,
                        cid: r.cid
                    },
                    record: JSON.parse(r.record)
                }
            }
            return null
        }).filter(x => x != null)

        await processor.process(refAndRecords)

        if(records.length < bs) break
        offset += bs
    }
}