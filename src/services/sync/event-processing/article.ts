import {processContentsBatch} from "#/services/sync/event-processing/content";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {getDidFromUri} from "#/utils/uri";
import {SyncContentProps} from "#/services/sync/types";
import {ATProtoStrongRef} from "#/lib/types";
import * as Article from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {getCidFromBlobRef} from "#/services/sync/utils";
import {RecordProcessor} from "#/services/sync/event-processing/record-processor";
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor";
import {unique} from "#/utils/arrays";


export class ArticleRecordProcessor extends RecordProcessor<Article.Record> {

    validateRecord = Article.validateRecord

    async addRecordsToDB(records: {ref: ATProtoStrongRef, record: Article.Record}[], reprocess: boolean = false) {
        const contents: { ref: ATProtoStrongRef, record: SyncContentProps }[] = records.map(r => ({
            record: {
                format: r.record.format,
                textBlob: {
                    cid: getCidFromBlobRef(r.record.text),
                    authorId: getDidFromUri(r.ref.uri)
                },
                embeds: r.record.embeds ?? [],
                selfLabels: isSelfLabels(r.record.labels) ? r.record.labels.values.map(l => l.val) : undefined,
            },
            ref: r.ref
        }))

        const articles = records.map(r => ({
            uri: r.ref.uri,
            title: r.record.title
        }))

        await this.ctx.kysely.transaction().execute(async (trx) => {
            await this.processRecordsBatch(trx, records)
            await processContentsBatch(trx, contents)

            await trx
                .insertInto("Article")
                .values(articles)
                .onConflict((oc) =>
                    oc.column("uri").doUpdateSet({
                        title: (eb) => eb.ref('excluded.title')
                    })
                )
                .execute()
        })

        const authors = unique(records.map(r => getDidFromUri(r.ref.uri)))
        if(!reprocess) await Promise.all([
            this.ctx.worker?.addJob("update-author-status", authors, 11),
            this.ctx.worker?.addJob("update-contents-topic-mentions", records.map(r => r.ref.uri), 11),
            this.ctx.worker?.addJob("update-interactions-score", records.map(r => r.ref.uri), 11)
        ])
    }
}


export class ArticleDeleteProcessor extends DeleteProcessor {
    async deleteRecordsFromDB(uris: string[]){
        await this.ctx.kysely.transaction().execute(async (trx) => {
            await trx
                .deleteFrom("TopicInteraction")
                .where("TopicInteraction.recordId", "in", uris)
                .execute()

            await trx
                .deleteFrom("HasReacted")
                .where("HasReacted.recordId", "in", uris)
                .execute()

            await trx
                .deleteFrom("Reference")
                .where("Reference.referencingContentId", "in", uris)
                .execute()

            await trx
                .deleteFrom("Article")
                .where("Article.uri", "in", uris)
                .execute()

            await trx
                .deleteFrom("Content")
                .where("Content.uri", "in", uris)
                .execute()

            await trx
                .deleteFrom("Record")
                .where("Record.uri", "in", uris)
                .execute()
        })
        await this.ctx.worker?.addJob("update-contents-topic-mentions", uris)
    }
}