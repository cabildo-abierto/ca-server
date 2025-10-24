import {getDidFromUri} from "#/utils/uri.js";
import {didToHandle} from "#/services/user/users.js";
import * as CAProfile from "#/lex-api/types/ar/cabildoabierto/actor/caProfile.js"
import {AppBskyActorProfile} from "@atproto/api"
import {ATProtoStrongRef} from "#/lib/types.js";
import {getCidFromBlobRef} from "#/services/sync/utils.js";
import {RecordProcessor} from "#/services/sync/event-processing/record-processor.js";
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor.js";
import {RefAndRecord} from "#/services/sync/types.js";
import {ValidationResult} from "@atproto/lexicon";
import {AppContext} from "#/setup.js";


export class CAProfileRecordProcessor extends RecordProcessor<CAProfile.Record> {

    validateRecord = CAProfile.validateRecord

    async addRecordsToDB(records: RefAndRecord<CAProfile.Record>[], reprocess: boolean = false) {
        await processCAProfilesBatch(this.ctx, records)
    }
}


export class CAProfileDeleteProcessor extends DeleteProcessor {

    async deleteRecordsFromDB(uris: string[]){
        const dids = uris.map(getDidFromUri)

        try {
            await this.ctx.kysely.transaction().execute(async (trx) => {
                await trx
                    .deleteFrom("Record")
                    .where("Record.uri", "in", uris)
                    .execute()

                await trx
                    .updateTable("User")
                    .set("inCA", false)
                    .set("hasAccess", false)
                    .where("User.did", "in", dids)
                    .execute()
            })
        } catch (error) {
            this.ctx.logger.pino.error({error, uris}, "error deleting ca profiles")
        }
    }
}


export class OldCAProfileRecordProcessor extends RecordProcessor<any> {

    validateRecord= (r: any): ValidationResult<any> => {
        return {
            success: true,
            value: r
        }
    }

    async addRecordsToDB(records: {ref: ATProtoStrongRef, record: any}[], reprocess: boolean = false) {
        await processCAProfilesBatch(this.ctx, records)
    }
}

async function processCAProfilesBatch(ctx: AppContext, records: RefAndRecord[]) {
    await ctx.kysely.transaction().execute(async (trx) => {
        await new RecordProcessor(ctx).processRecordsBatch(trx, records)
        const values = records.map(r => {
            return {
                did: getDidFromUri(r.ref.uri),
                CAProfileUri: r.ref.uri,
                inCA: true,
                created_at_tz: r.record.created_at
            }
        })
        await trx
            .insertInto("User")
            .values(values)
            .onConflict(oc => oc.column("did").doUpdateSet(() => ({
                CAProfileUri: eb => eb.ref("excluded.CAProfileUri"),
                inCA: eb => eb.ref("excluded.inCA"),
                created_at_tz: eb => eb.ref("excluded.created_at_tz")
            })))
            .execute()
    })
}


export class BskyProfileRecordProcessor extends RecordProcessor<AppBskyActorProfile.Record> {

    validateRecord = AppBskyActorProfile.validateRecord

    async addRecordsToDB(records: RefAndRecord<AppBskyActorProfile.Record>[], reprocess: boolean = false) {
        const values: {
            did: string
            description?: string
            displayName?: string
            avatar?: string
            banner?: string
            handle?: string
            created_at_tz?: Date
        }[] = []

        for (const {ref, record: r} of records) {
            const ctx = this.ctx
            const did = getDidFromUri(ref.uri)
            const avatarCid = r.avatar ? getCidFromBlobRef(r.avatar) : undefined
            const avatar = avatarCid ? avatarUrl(did, avatarCid) : undefined
            const bannerCid = r.banner ? getCidFromBlobRef(r.banner) : undefined
            const banner = bannerCid ? bannerUrl(did, bannerCid) : undefined

            const handle = await didToHandle(ctx, did)

            if(handle == null) {
                ctx.logger.pino.error({did}, "couldn't get handle for bsky profile")
                continue
            }

            values.push({
                did: did,
                description: r.description != null ? r.description : undefined,
                displayName: r.displayName != null ? r.displayName : undefined,
                avatar,
                banner,
                handle,
                created_at_tz: r.createdAt ? new Date(r.createdAt) : undefined
            })
        }

        await this.ctx.kysely
            .insertInto("User")
            .values(values)
            .onConflict(oc => oc.column("did").doUpdateSet(() => ({
                handle: eb => eb.ref("excluded.handle"),
                avatar: eb => eb.ref("excluded.avatar"),
                banner: eb => eb.ref("excluded.banner"),
                displayName: eb => eb.ref("excluded.displayName"),
                created_at_tz: eb => eb.ref("excluded.created_at_tz"),
                description: eb => eb.ref("excluded.description")
            })))
            .execute()
    }
}


function avatarUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/avatar/plain/" + did + "/" + cid + "@jpeg"
}

function bannerUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/banner/plain/" + did + "/" + cid + "@jpeg"
}