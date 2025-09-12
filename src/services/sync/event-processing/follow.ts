import * as Follow from "#/lex-api/types/app/bsky/graph/follow"
import {createUsersBatch, processRecordsBatch} from "#/services/sync/event-processing/record";
import {RecordProcessor} from "#/services/sync/event-processing/record-processor";
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor";
import {RefAndRecord} from "#/services/sync/types";



export class FollowRecordProcessor extends RecordProcessor<Follow.Record> {
    validateRecord = Follow.validateRecord

    async addRecordsToDB(records: RefAndRecord<Follow.Record>[]) {
        await this.ctx.kysely.transaction().execute(async (trx) => {
            await processRecordsBatch(trx, records)
            await createUsersBatch(trx, records.map(r => r.record.subject))

            const follows = records.map(r => ({
                uri: r.ref.uri,
                userFollowedId: r.record.subject
            }))

            await trx
                .insertInto("Follow")
                .values(follows)
                .onConflict((oc) =>
                    oc.column("uri").doUpdateSet({
                        userFollowedId: (eb) => eb.ref('excluded.userFollowedId'),
                    })
                )
                .execute()
        })
    }
}


export class FollowDeleteProcessor extends DeleteProcessor {
    async deleteRecordsFromDB(uris: string[]){
        await this.ctx.kysely.transaction().execute(async (trx) => {
            await trx
                .deleteFrom("Follow")
                .where("Follow.uri", "in", uris)
                .execute()

            await trx
                .deleteFrom("Record")
                .where("Record.uri", "in", uris)
                .execute()
        })
    }
}