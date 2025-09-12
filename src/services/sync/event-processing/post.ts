import {ATProtoStrongRef} from "#/lib/types";
import {
    getCollectionFromUri,
    getDidFromUri,
    isArticle,
    isTopicVersion
} from "#/utils/uri";
import * as Post from "#/lex-api/types/app/bsky/feed/post"
import {
    isMain as isVisualizationEmbed,
    isDatasetDataSource
} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {
    RefAndRecord,
    SyncContentProps
} from "#/services/sync/types";
import {NotificationJobData} from "#/services/notifications/notifications";
import {processDirtyRecordsBatch, processRecordsBatch} from "#/services/sync/event-processing/record";
import {processContentsBatch} from "#/services/sync/event-processing/content";
import {RecordProcessor} from "#/services/sync/event-processing/record-processor";
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor";
import {isMain as isMainRecordEmbed} from "#/lex-api/types/app/bsky/embed/record";
import {isMain as isMainRecordEmbedWithMedia} from "#/lex-api/types/app/bsky/embed/recordWithMedia";
import type {$Typed} from "#/lex-api/util";
import type * as AppBskyEmbedRecord from "#/lex-api/types/app/bsky/embed/record";
import type * as AppBskyEmbedRecordWithMedia from "#/lex-api/types/app/bsky/embed/recordWithMedia";


export class PostRecordProcessor extends RecordProcessor<Post.Record> {

    validateRecord = Post.validateRecord

    async addRecordsToDB(records: RefAndRecord<Post.Record>[]) {
        const insertedPosts = await this.ctx.kysely.transaction().execute(async (trx) => {
            await processRecordsBatch(trx, records)
            const referencedRefs: ATProtoStrongRef[] = records.reduce((acc, r) => {
                let quoteRef: ATProtoStrongRef | undefined = undefined
                if (isMainRecordEmbed(r.record.embed)){
                    quoteRef = {uri: r.record.embed.record.uri, cid: r.record.embed.record.cid}
                }
                else {
                    if (isMainRecordEmbedWithMedia(r.record.embed)){
                        quoteRef = {uri: r.record.embed.record.record.uri, cid: r.record.embed.record.record.cid}
                    }
                }

                return [
                    ...acc,
                    ...(r.record.reply?.root ? [{uri: r.record.reply.root.uri, cid: r.record.reply.root.cid}] : []),
                    ...(r.record.reply?.parent ? [{uri: r.record.reply.parent.uri, cid: r.record.reply.parent.cid}] : []),
                    ...(quoteRef? [quoteRef] : [])
                ]
            }, [] as ATProtoStrongRef[])
            await processDirtyRecordsBatch(trx, referencedRefs)

            const contents: { ref: ATProtoStrongRef, record: SyncContentProps }[] = records.map(r => {
                let datasetsUsed: string[] = []
                if (isVisualizationEmbed(r.record.embed) && isDatasetDataSource(r.record.embed.dataSource)) {
                    datasetsUsed.push(r.record.embed.dataSource.dataset)
                }

                return {
                    ref: r.ref,
                    record: {
                        format: "plain-text",
                        text: r.record.text,
                        selfLabels: isSelfLabels(r.record.labels) ? r.record.labels.values.map(l => l.val) : undefined,
                        datasetsUsed,
                        embeds: []
                    }
                }
            })

            await processContentsBatch(trx, contents)

            const posts = records.map(({ref, record: r}) => {
                return {
                    facets: r.facets ? JSON.stringify(r.facets) : null,
                    embed: r.embed ? JSON.stringify(r.embed) : null,
                    uri: ref.uri,
                    replyToId: r.reply ? r.reply.parent.uri as string : null,
                    rootId: r.reply && r.reply.root ? r.reply.root.uri : null,
                    langs: r.langs ?? []
                }
            })

            const existing = await trx
                .selectFrom("Post")
                .select("uri")
                .where("uri", "in", posts.map(p => p.uri))
                .execute()

            const existingSet = new Set(existing.map(p => p.uri))

            await trx
                .insertInto("Post")
                .values(posts)
                .onConflict((oc) =>
                    oc.column("uri").doUpdateSet({
                        facets: (eb) => eb.ref('excluded.facets'),
                        replyToId: (eb) => eb.ref('excluded.replyToId'),
                        rootId: (eb) => eb.ref('excluded.rootId'),
                    })
                )
                .execute()

            return posts
                .filter(p => !existingSet.has(p.uri))
        })

        if (insertedPosts) {
            await Promise.all([
                this.createNotifications(insertedPosts),
                this.ctx.worker?.addJob("update-contents-topic-mentions", {uris: insertedPosts.map(r => r.uri)})
            ])
        }
    }

    async createNotifications(posts: {replyToId: string | null, uri: string}[]) {
        for(const p of posts) {
            if (p.replyToId) {
                const replyToDid = getDidFromUri(p.replyToId)
                if (replyToDid != getDidFromUri(p.uri)) {
                    const c = getCollectionFromUri(p.replyToId)
                    if (isArticle(c) || isTopicVersion(c)) {
                        const data: NotificationJobData = {
                            userNotifiedId: getDidFromUri(p.replyToId),
                            type: "Reply",
                            causedByRecordId: p.uri,
                            createdAt: new Date().toISOString(),
                            reasonSubject: p.replyToId,
                        }
                        this.ctx.worker?.addJob("create-notification", data)
                    }
                }
            }
        }
    }
}


export class PostDeleteProcessor extends DeleteProcessor {
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
                .deleteFrom("Post")
                .where("Post.uri", "in", uris)
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
    }
}