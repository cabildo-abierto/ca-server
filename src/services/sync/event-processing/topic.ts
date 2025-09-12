import {AppContext} from "#/setup";
import { ATProtoStrongRef } from "#/lib/types";
import {RefAndRecord, SyncContentProps} from "#/services/sync/types";
import {getDidFromUri} from "#/utils/uri";
import {processRecordsBatch} from "#/services/sync/event-processing/record";
import {processContentsBatch} from "#/services/sync/event-processing/content";
import {ExpressionBuilder, OnConflictDatabase, OnConflictTables, sql} from "kysely";
import {DB} from "../../../../prisma/generated/types";
import {NotificationBatchData} from "#/services/notifications/notifications";
import {getCidFromBlobRef} from "#/services/sync/utils";
import * as TopicVersion from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {
    RecordProcessor
} from "#/services/sync/event-processing/record-processor";
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor";
import {unique} from "#/utils/arrays";
import {updateTopicsCurrentVersionBatch} from "#/services/wiki/current-version";


export class TopicVersionRecordProcessor extends RecordProcessor<TopicVersion.Record> {

    validateRecord = TopicVersion.validateRecord

    async addRecordsToDB(records: RefAndRecord<TopicVersion.Record>[]) {
        const contents: { ref: ATProtoStrongRef, record: SyncContentProps }[] = records.map(r => ({
            record: {
                format: r.record.format,
                textBlob: r.record.text ? {
                    cid: getCidFromBlobRef(r.record.text),
                    authorId: getDidFromUri(r.ref.uri)
                } : undefined,
                embeds: r.record.embeds ?? []
            },
            ref: r.ref
        }))

        const topics = getUniqueTopicUpdates(records)

        const topicVersions = records.map(r => ({
            uri: r.ref.uri,
            topicId: r.record.id,
            message: r.record.message ? r.record.message : undefined,
            props: r.record.props ? JSON.stringify(r.record.props) : undefined,
            authorship: r.record.claimsAuthorship ?? false
        }))

        const inserted = await this.ctx.kysely.transaction().execute(async (trx) => {
            await processRecordsBatch(trx, records)
            await processContentsBatch(trx, contents)

            try {
                await trx
                    .insertInto("Topic")
                    .values(topics)
                    .onConflict((oc) => oc.column("id").doUpdateSet({
                        lastEdit: sql`GREATEST
                    ("Topic"."lastEdit", excluded."lastEdit")`
                    }))
                    .execute()
            } catch (err) {
                console.log("Error processing topics")
                console.log(err)
            }

            try {
                if(topicVersions.length > 0){
                    const inserted = await trx
                        .insertInto("TopicVersion")
                        .values(topicVersions)
                        .onConflict(oc => oc.column("uri").doUpdateSet({
                            topicId: eb => eb.ref("excluded.topicId"),
                            message: (eb) => eb.ref("excluded.message"),
                            props: (eb: ExpressionBuilder<OnConflictDatabase<DB, "TopicVersion">, OnConflictTables<"TopicVersion">>) => eb.ref("excluded.props")
                        }))
                        .returning(["topicId", "TopicVersion.uri"])
                        .execute()

                    await updateTopicsCurrentVersionBatch(trx, inserted.map(t => t.topicId))

                    return inserted
                } else {
                    return []
                }
            } catch (err) {
                console.log("error inserting topic versions", err)
            }

        })

        if (inserted) {
            const data: NotificationBatchData = {
                uris: inserted.map(i => i.uri),
                topics: inserted.map(i => i.topicId),
                type: "TopicEdit"
            }
            this.ctx.worker?.addJob("batch-create-notifications", data)
        }

        await addUpdateContributionsJobForTopics(this.ctx, topics.map(t => t.id))

        const authors = unique(records.map(r => getDidFromUri(r.ref.uri)))
        await this.ctx.worker?.addJob("update-author-status", {dids: authors})
    }
}


export class TopicVersionDeleteProcessor extends DeleteProcessor {
    async deleteRecordsFromDB(uris: string[]){
        await processDeleteTopicVersionsBatch(this.ctx, uris)
    }
}


function getUniqueTopicUpdates(records: { ref: ATProtoStrongRef, record: TopicVersion.Record }[]) {
    const topics = new Map<string, { id: string, lastEdit: Date }>()
    records.forEach(r => {
        const id = r.record.id
        const cur = topics.get(id)
        const date = new Date(r.record.createdAt)
        if (!cur) {
            topics.set(id, {id, lastEdit: date})
        } else {
            topics.set(id, {id, lastEdit: cur.lastEdit > date ? cur.lastEdit : date})
        }
    })
    return Array.from(topics.values())
}


export async function addUpdateContributionsJobForTopics(ctx: AppContext, ids: string[]) {
    await ctx.worker?.addJob(
        "update-topic-contributions",
        {topicIds: ids}
    )
}


export async function processDeleteTopicVersionsBatch(ctx: AppContext, uris: string[]) {
    await ctx.kysely.transaction().execute(async (trx) => {
        try {
            const topicIds = await trx
                .selectFrom("Topic")
                .innerJoin("TopicVersion", "TopicVersion.topicId", "Topic.id")
                .select(["id"])
                .where("TopicVersion.uri", "in", uris)
                .execute()

            await trx
                .deleteFrom("HasReacted")
                .where("recordId", "in", uris)
                .execute()

            await trx
                .deleteFrom("VoteReject")
                .using("Reaction")
                .whereRef("VoteReject.uri", "=", "Reaction.uri")
                .where("Reaction.subjectId", "in", uris)
                .execute()

            await trx
                .deleteFrom("Reaction")
                .where("subjectId", "in", uris)
                .execute()

            await trx
                .deleteFrom("Reference")
                .where("referencingContentId", "in", uris)
                .execute()

            await trx
                .deleteFrom("TopicVersion")
                .where("uri", "in", uris)
                .execute()

            await trx
                .deleteFrom("Content")
                .where("uri", "in", uris)
                .execute()

            await trx
                .deleteFrom("Record")
                .where("uri", "in", uris)
                .execute()

            console.log("updating topic current versions for", topicIds.map(t => t.id))
            await updateTopicsCurrentVersionBatch(trx, topicIds.map(t => t.id))
        } catch (err) {
            console.log(err)
            console.log("Error deleting topic versions")
            return
        }

    })
}