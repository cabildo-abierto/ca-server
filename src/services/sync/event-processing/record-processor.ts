import {AppContext} from "#/setup";
import {ATProtoStrongRef} from "#/lib/types";
import {getCollectionFromUri} from "#/utils/uri";
import {ValidationResult} from "@atproto/lexicon";
import {parseRecord} from "#/services/sync/parse";
import {RefAndRecord} from "#/services/sync/types";


export class RecordProcessor<T> {
    ctx: AppContext

    constructor(ctx: AppContext) {
        this.ctx = ctx
    }

    async process(records: RefAndRecord[]) {
        if(records.length == 0) return
        const validatedRecords = this.parseRecords(records)
        await this.processValidated(validatedRecords)
    }

    async processValidated(records: RefAndRecord<T>[]) {
        if(records.length == 0) return
        await this.addRecordsToDB(records)
        await this.ctx.redisCache.onUpdateRecords(records)
    }

    validateRecord(record: any): ValidationResult<T> {
        this.ctx.logger.pino.info("Warning: Validación sin implementar para este tipo de record.")
        return {
            success: false,
            error: Error("Sin implementar")
        }
    }

    async addRecordsToDB(records: RefAndRecord<T>[]) {
        if(records.length == 0) return
        this.ctx.logger.pino.info({uri: records[0].ref.uri}, "Warning: Validación sin implementar para este tipo de record.")
    }

    async processInBatches(records: RefAndRecord[]){
        if(records.length == 0) return

        const collection = getCollectionFromUri(records[0].ref.uri)

        const batchSize = 1000
        for (let i = 0; i < records.length; i+=batchSize) {
            const t1 = Date.now()
            const batchRecords = records.slice(i, i+batchSize)
            await this.process(batchRecords)
            const t2 = Date.now()
            this.ctx.logger.pino.info(`${collection}: processed batch ${i+1} of ${records.length} in ${t2-t1}ms`)
        }
    }

    parseRecords(records: RefAndRecord[]): {
        ref: ATProtoStrongRef,
        record: T
    }[] {
        const parsedRecords: RefAndRecord<T>[] = []
        for (const {ref, record} of records) {
            const parsedRecord = parseRecord(record)
            const res = this.validateRecord(parsedRecord)
            if (res.success) {
                parsedRecords.push({
                    ref,
                    record: res.value
                })
            } else {
                console.log("Invalid record:", ref.uri)
                console.log("Reason:", res.error.message)
            }
        }
        return parsedRecords
    }
}




