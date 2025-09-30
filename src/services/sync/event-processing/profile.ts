import {getDidFromUri} from "#/utils/uri";
import {didToHandle} from "#/services/user/users";
import * as CAProfile from "#/lex-api/types/ar/cabildoabierto/actor/caProfile"
import {AppBskyActorProfile} from "@atproto/api"
import {AppContext} from "#/setup";
import {ATProtoStrongRef} from "#/lib/types";
import {getCidFromBlobRef} from "#/services/sync/utils";
import {RecordProcessor} from "#/services/sync/event-processing/record-processor";
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor";
import {processRecordsBatch} from "#/services/sync/event-processing/record";
import {RefAndRecord} from "#/services/sync/types";
import {ValidationResult} from "@atproto/lexicon";


export class CAProfileRecordProcessor extends RecordProcessor<CAProfile.Record> {

    validateRecord = CAProfile.validateRecord

    async addRecordsToDB(records: RefAndRecord<CAProfile.Record>[]) {
        for(const r of records) {
            await processCAProfile(this.ctx, r)
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

    async addRecordsToDB(records: {ref: ATProtoStrongRef, record: any}[]) {
        for(const r of records) {
            await processCAProfile(this.ctx, r)
        }
    }
}


export class CAProfileDeleteProcessor extends DeleteProcessor {

    async deleteRecordsFromDB(uris: string[]){
        const dids = uris.map(getDidFromUri)

        await this.ctx.kysely.transaction().execute(async (trx) => {
            await trx
                .deleteFrom("Record")
                .where("Record.uri", "in", uris)
                .execute()

            await trx
                .updateTable("User")
                .set("User.inCA", false)
                .set("User.hasAccess", false)
                .where("User.did", "in", dids)
                .execute()
        })
    }
}


async function processCAProfile(ctx: AppContext, {ref, record}: RefAndRecord) {
    await ctx.kysely.transaction().execute(async (trx) => {
        await processRecordsBatch(trx, [{ref, record}])
        const did = getDidFromUri(ref.uri)
        await trx
            .updateTable("User")
            .where("did", "=", did)
            .set({
                CAProfileUri: ref.uri,
                inCA: true
            })
            .execute()
    })
}


export class BskyProfileRecordProcessor extends RecordProcessor<AppBskyActorProfile.Record> {

    validateRecord = AppBskyActorProfile.validateRecord

    async addRecordsToDB(records: RefAndRecord<AppBskyActorProfile.Record>[]) {
        for(const {ref, record: r} of records) {
            const ctx = this.ctx
            const did = getDidFromUri(ref.uri)
            const avatarCid = r.avatar ? getCidFromBlobRef(r.avatar) : undefined
            const avatar = avatarCid ? avatarUrl(did, avatarCid) : undefined
            const bannerCid = r.banner ? getCidFromBlobRef(r.banner) : undefined
            const banner = bannerCid ? bannerUrl(did, bannerCid) : undefined

            const handle = await didToHandle(ctx, did)

            if (handle == null) {
                throw Error("Error processing BskyProfile")
            }

            await ctx.kysely.transaction().execute(async (trx) => {
                await processRecordsBatch(trx, [{ref, record: r}])
                const did = getDidFromUri(ref.uri)
                await trx
                    .updateTable("User")
                    .where("did", "=", did)
                    .set({
                        description: r.description != null ? r.description : undefined,
                        displayName: r.displayName != null ? r.displayName : undefined,
                        avatar,
                        banner,
                        handle
                    })
                    .execute()
            })
        }
    }
}


function avatarUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/avatar/plain/" + did + "/" + cid + "@jpeg"
}

function bannerUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/banner/plain/" + did + "/" + cid + "@jpeg"
}