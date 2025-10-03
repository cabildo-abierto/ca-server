import {
    getCollectionFromUri,
    getDidFromUri
} from "#/utils/uri";
import {Transaction} from "kysely";
import {ReactionRecord, ReactionType} from "#/services/reactions/reactions";
import {v4 as uuidv4} from 'uuid'
import {isTopicVote} from "#/services/wiki/votes";
import {isRecord as isVoteReject} from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject"
import {unique} from "#/utils/arrays";
import {NotificationJobData} from "#/services/notifications/notifications";
import {isReactionCollection} from "#/utils/type-utils";
import {
    addUpdateContributionsJobForTopics
} from "#/services/sync/event-processing/topic";
import {processDirtyRecordsBatch, processRecordsBatch} from "#/services/sync/event-processing/record";
import {DB} from "../../../../prisma/generated/types";
import {RecordProcessor} from "#/services/sync/event-processing/record-processor";
import {AppBskyFeedLike, AppBskyFeedRepost} from "@atproto/api"
import * as VoteAccept from "#/lex-api/types/ar/cabildoabierto/wiki/voteAccept"
import * as VoteReject from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject"
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor";
import {updateTopicsCurrentVersionBatch} from "#/services/wiki/current-version";
import {RefAndRecord} from "#/services/sync/types";


const columnMap: Record<ReactionType, keyof DB['Record']> = {
    'app.bsky.feed.like': 'uniqueLikesCount',
    'app.bsky.feed.repost': 'uniqueRepostsCount',
    'ar.cabildoabierto.wiki.voteAccept': 'uniqueAcceptsCount',
    'ar.cabildoabierto.wiki.voteReject': 'uniqueRejectsCount',
}


export class ReactionRecordProcessor extends RecordProcessor<ReactionRecord> {

    async addRecordsToDB(records: RefAndRecord<ReactionRecord>[]){
        const res = await this.ctx.kysely.transaction().execute(async (trx) => {
            const reactionType = getCollectionFromUri(records[0].ref.uri)
            if (!isReactionType(reactionType)) return

            await processRecordsBatch(trx, records)

            const subjects = records.map(r => ({uri: r.record.subject.uri, cid: r.record.subject.cid}))
            await processDirtyRecordsBatch(trx, subjects)

            const reactions = records.map(r => ({
                uri: r.ref.uri,
                subjectId: r.record.subject.uri
            }))

            await trx
                .insertInto("Reaction")
                .values(reactions)
                .onConflict((oc) =>
                    oc.column("uri").doUpdateSet({
                        subjectId: (eb) => eb.ref('excluded.subjectId'),
                    })
                )
                .execute()

            const hasReacted = records.map(r => ({
                userId: getDidFromUri(r.ref.uri),
                recordId: r.record.subject.uri,
                reactionType: getCollectionFromUri(r.ref.uri),
                id: uuidv4()
            }))

            const inserted = await trx
                .insertInto("HasReacted")
                .values(hasReacted)
                .onConflict(oc => oc.doNothing())
                .returning(['recordId'])
                .execute()

            await this.batchIncrementReactionCounter(trx, reactionType, inserted.map(r => r.recordId))

            if (isTopicVote(reactionType)) {
                if (isVoteReject(reactionType)) {
                    const votes: { uri: string, message: string | null, labels: string[] }[] = records.map(r => {
                        if (isVoteReject(r.record)) {
                            return {
                                uri: r.ref.uri,
                                message: r.record.message ?? null,
                                labels: r.record.labels ?? []
                            }
                        }
                        return null
                    }).filter(v => v != null)

                    await trx
                        .insertInto("VoteReject")
                        .values(votes)
                        .onConflict((oc) =>
                            oc.column("uri").doUpdateSet({
                                message: (eb) => eb.ref('excluded.message'),
                                labels: (eb) => eb.ref('excluded.labels'),
                            })
                        )
                        .execute()
                }

                let topicVotes = (await trx
                    .selectFrom("TopicVersion")
                    .innerJoin("Reaction", "TopicVersion.uri", "Reaction.subjectId")
                    .select(["TopicVersion.topicId", "TopicVersion.uri", "Reaction.uri as reactionUri"])
                    .where("Reaction.uri", "in", records.map(r => r.ref.uri))
                    .where("TopicVersion.uri", "in", inserted.map(r => r.recordId))
                    .execute())

                const topicIdsList = unique(topicVotes.map(t => t.topicId))

                await updateTopicsCurrentVersionBatch(this.ctx, trx, topicIdsList)

                return {topicIdsList, topicVotes}
            }
        })

        if (res) {
            const data: NotificationJobData[] = res.topicVotes.map(t => ({
                type: "TopicVersionVote",
                uri: t.reactionUri,
                subjectId: t.uri,
                topic: t.topicId
            }))
            this.ctx.worker?.addJob("batch-create-notifications", data)
            await addUpdateContributionsJobForTopics(this.ctx, res.topicIdsList)
        }

        function isLikeOrRepost(r: RefAndRecord) {
            return ["app.bsky.feed.like", "app.bsky.feed.repost"].includes(getCollectionFromUri(r.ref.uri))
        }

        const likeAndRepostsSubjects = records
            .filter(isLikeOrRepost)
            .map(r => r.record.subject.uri)

        if(likeAndRepostsSubjects.length > 0) {
            await this.ctx.worker?.addJob(
                "update-interactions-score",
                likeAndRepostsSubjects
            )
        }
    }

    async batchIncrementReactionCounter(
        trx: Transaction<DB>,
        type: ReactionType,
        recordIds: string[]
    ) {
        const column = columnMap[type]

        if (!column) {
            throw new Error(`Unknown reaction type: ${type}`)
        }

        if (recordIds.length == 0) return

        await trx
            .updateTable('Record')
            .where('uri', 'in', recordIds)
            .set((eb) => ({
                [column]: eb(eb.ref(column), '+', 1)
            }))
            .execute()
    }
}


export class LikeRecordProcessor extends ReactionRecordProcessor {
    validateRecord = AppBskyFeedLike.validateRecord
}


export class RepostRecordProcessor extends ReactionRecordProcessor {
    validateRecord = AppBskyFeedRepost.validateRecord
}


export class VoteAcceptRecordProcessor extends ReactionRecordProcessor {
    validateRecord = VoteAccept.validateRecord
}


export class VoteRejectRecordProcessor extends ReactionRecordProcessor {
    validateRecord = VoteReject.validateRecord
}


export class ReactionDeleteProcessor extends DeleteProcessor {
    async deleteRecordsFromDB(uris: string[]){
        if (uris.length == 0) return
        const type = getCollectionFromUri(uris[0])
        if (!isReactionCollection(type)) return

        const ids = await this.ctx.kysely.transaction().execute(async (db) => {
            const subjectIds = (await db
                .selectFrom("Reaction")
                .select(["subjectId", "uri"])
                .where("uri", "in", uris)
                .execute())
                .map(e => e.subjectId != null ? {...e, subjectId: e.subjectId} : null)
                .filter(x => x != null)

            if (subjectIds.length == 0) return

            try {
                const deletedSubjects = await db
                    .deleteFrom("HasReacted")
                    .where("reactionType", "=", type)
                    .where(({eb, refTuple, tuple}) =>
                        eb(
                            refTuple("HasReacted.recordId", 'HasReacted.userId'),
                            'in',
                            subjectIds.map(e => tuple(e.subjectId, getDidFromUri(e.uri)))
                        )
                    )
                    .returning(["HasReacted.recordId"])
                    .execute()

                await this.batchDecrementReactionCounter(db, type, deletedSubjects.map(u => u.recordId))
            } catch {}

            const sameSubjectUris = (await db
                .selectFrom("Reaction")
                .innerJoin("Record", "Record.uri", "Reaction.uri")
                .select("Record.uri")
                .where("Record.collection", "=", type)
                .where(({eb, refTuple, tuple}) =>
                    eb(
                        refTuple("Reaction.subjectId", 'Record.authorId'),
                        'in',
                        subjectIds.map(e => tuple(e.subjectId, getDidFromUri(e.uri)))
                    )
                )
                .execute()).map(u => u.uri)

            if (sameSubjectUris.length > 0) {
                if (type == "ar.cabildoabierto.wiki.voteReject") {
                    await db
                        .deleteFrom("VoteReject")
                        .where("uri", "in", sameSubjectUris)
                        .execute()
                }

                await db.deleteFrom("TopicInteraction").where("recordId", "in", sameSubjectUris).execute()

                await db.deleteFrom("Notification").where("causedByRecordId", "in", sameSubjectUris).execute()

                await db.deleteFrom("Reaction").where("uri", "in", sameSubjectUris).execute()

                for (const u of sameSubjectUris) {
                    await db.deleteFrom("Record").where("uri", "in", [u]).execute()
                }
                //await db.deleteFrom("Record").where("uri", "in", sameSubjectUris).execute()
            }

            if (type == "ar.cabildoabierto.wiki.voteReject" || type == "ar.cabildoabierto.wiki.voteAccept") {
                const topicIds = (await db
                    .selectFrom("TopicVersion")
                    .select("topicId")
                    .where("uri", "in", subjectIds.map(s => s.subjectId))
                    .execute()).map(t => t.topicId)

                if (topicIds.length > 0) {
                    await db.transaction().execute(async trx => {
                        await updateTopicsCurrentVersionBatch(this.ctx, trx, topicIds)
                    })
                    return topicIds
                }
            }
        })
        if (ids && ids.length > 0) {
            await addUpdateContributionsJobForTopics(this.ctx, ids)
        }
    }


    async batchDecrementReactionCounter(
        trx: Transaction<DB>,
        type: ReactionType,
        recordIds: string[]
    ) {
        const column = columnMap[type]

        if (!column) {
            throw new Error(`Unknown reaction type: ${type}`)
        }

        if (recordIds.length == 0) return

        await trx
            .updateTable('Record')
            .where('uri', 'in', recordIds)
            .set((eb) => ({
                [column]: eb(eb.ref(column), '-', 1)
            }))
            .execute()
    }
}


export function isReactionType(collection: string): collection is ReactionType {
    return [
        "app.bsky.feed.like",
        "app.bsky.feed.repost",
        "ar.cabildoabierto.wiki.voteAccept",
        "ar.cabildoabierto.wiki.voteReject"
    ].includes(collection)
}