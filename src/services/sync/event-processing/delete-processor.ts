import {AppContext} from "#/setup";
import {getCollectionFromUri} from "#/utils/uri";


export class DeleteProcessor {
    ctx: AppContext

    constructor(ctx: AppContext) {
        this.ctx = ctx
    }

    async process(uris: string[]) {
        await this.deleteRecordsFromDB(uris)
        await this.ctx.redisCache.onUpdateRecords(uris)
    }

    async deleteRecordsFromDB(uris: string[]) {
        await this.ctx.kysely
            .deleteFrom("Record")
            .where("Record.uri", "in", uris)
            .execute()
    }

    async processInBatches(uris: string[]) {
        if(uris.length == 0) return
        const c = getCollectionFromUri(uris[0])
        const batchSize = 500
        for (let j = 0; j < uris.length; j += batchSize) {
            console.log(`deleting batch ${j} of ${uris.length} entries of type ${c}`)
            const batchUris = uris.slice(j, j + batchSize)
            await this.process(batchUris)
            console.log("batch of deletes finished")
        }
    }
}


