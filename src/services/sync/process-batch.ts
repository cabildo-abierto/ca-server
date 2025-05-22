import {ATProtoStrongRef, UserRepoElement} from "#/lib/types";
import {getCollectionFromUri, getDidFromUri, getRkeyFromUri, isTopicVersion, splitUri} from "#/utils/uri";
import * as Post from "#/lex-api/types/app/bsky/feed/post"
import * as Follow from "#/lex-api/types/app/bsky/graph/follow"
import * as Like from "#/lex-api/types/app/bsky/feed/like"
import * as Repost from "#/lex-api/types/app/bsky/feed/repost"
import * as Dataset from "#/lex-api/types/ar/cabildoabierto/data/dataset"
import * as Article from "#/lex-api/types/ar/cabildoabierto/feed/article"
import * as TopicVersion from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import * as VoteAccept from "#/lex-api/types/ar/cabildoabierto/wiki/voteAccept"
import * as VoteReject from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject"
import * as BskyProfile from "#/lex-api/types/app/bsky/actor/profile"
import * as CAProfile from "#/lex-api/types/ar/cabildoabierto/actor/caProfile"
import {AppContext} from "#/index";
import {
    isMain as isVisualizationEmbed,
    isDatasetDataSource
} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {ExpressionBuilder, OnConflictDatabase, OnConflictTables, Transaction} from "kysely";
import {DB} from "../../../prisma/generated/types";
import {ValidationResult} from "@atproto/lexicon";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {
    getCidFromBlobRef,
    parseRecord, processBskyProfile,
    processCAProfile, processDeleteReaction,
    SyncContentProps
} from "#/services/sync/process-event";
import {ReactionRecord, ReactionType} from "#/services/reactions/reactions";
import {v4 as uuidv4} from 'uuid'
import {isTopicVote} from "#/services/topic/votes";
import {isRecord as isVoteReject} from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject"
import {JsonArray} from "@prisma/client/runtime/library";
import {Prisma} from "@prisma/client";
import {deleteRecordsDB} from "#/services/delete";


export async function processRecordsBatch(trx: Transaction<DB>, records: { ref: ATProtoStrongRef, record: any }[]) {
    const data: {
        uri: string,
        cid: string,
        rkey: string,
        collection: string,
        created_at?: Date,
        authorId: string,
        record: string
    }[] = []

    records.forEach(r => {
        const {ref, record} = r
        const {did, collection, rkey} = splitUri(ref.uri)
        data.push({
            uri: ref.uri,
            cid: ref.cid,
            rkey,
            collection,
            created_at: record.createdAt ? new Date(record.createdAt) : undefined,
            authorId: did,
            record: JSON.stringify(record)
        })
    })

    await trx
        .insertInto('Record')
        .values(data)
        .onConflict((oc) =>
            oc.column("uri").doUpdateSet({
                cid: (eb) => eb.ref('excluded.cid'),
                rkey: (eb) => eb.ref('excluded.rkey'),
                collection: (eb) => eb.ref('excluded.collection'),
                created_at: (eb) => eb.ref('excluded.created_at'),
                authorId: (eb) => eb.ref('excluded.authorId'),
                record: (eb) => eb.ref('excluded.record'),
            })
        )
        .execute()
}


export async function processUsersBatch(trx: Transaction<DB>, dids: string[]) {
    if(dids.length == 0) return
    await trx
        .insertInto("User")
        .values(dids.map(did => ({did})))
        .onConflict((oc) => oc.column("did").doNothing())
        .execute()
}


export async function processDirtyRecordsBatch(trx: Transaction<DB>, refs: ATProtoStrongRef[]) {
    if(refs.length == 0) return

    const users = refs.map(r => getDidFromUri(r.uri))
    await processUsersBatch(trx, users)

    const data = refs.map(({uri, cid}) => ({
        uri,
        rkey: getRkeyFromUri(uri),
        collection: getCollectionFromUri(uri),
        authorId: getDidFromUri(uri),
        cid,
        record: null
    }))

    if (data.length == 0) return

    await trx
        .insertInto("Record")
        .values(data)
        .onConflict((oc) => oc.column("uri").doNothing())
        .execute()
}


export async function processFollowsBatch(ctx: AppContext, records: {
    ref: ATProtoStrongRef,
    record: Follow.Record
}[]) {
    await ctx.kysely.transaction().execute(async (trx) => {
        await processRecordsBatch(trx, records)

        await processUsersBatch(trx, records.map(r => r.record.subject))

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


export type BatchRecordProcessor<T> = (
    ctx: AppContext,
    records: {
        ref: ATProtoStrongRef,
        record: T
    }[],
    afterTransaction?: (trx: Transaction<DB>) => Promise<void>) => Promise<void>


export const processContentsBatch = async (trx: Transaction<DB>, records: {
    ref: ATProtoStrongRef,
    record: SyncContentProps
}[]) => {
    if (records.length == 0) return

    const blobData = records.map(c => {
        return c.record.textBlob ?? null
    }).filter(b => b != null)

    if (blobData.length > 0) {
        await trx
            .insertInto("Blob")
            .values(blobData)
            .onConflict((oc) => oc.column("cid").doNothing())
            .execute()
    }

    const contentDatasetLinks = records.flatMap(c =>
        (c.record.datasetsUsed ?? []).map(datasetUri => ({
            A: c.ref.uri,
            B: datasetUri
        }))
    )

    const contentData = records.map(c => {
        const r = c.record
        return {
            text: r.text,
            textBlobId: r.textBlob?.cid,
            uri: c.ref.uri,
            format: r.format,
            selfLabels: r.selfLabels ?? []
        }
    })

    if (contentData.length > 0) {
        await trx
            .insertInto("Content")
            .values(contentData)
            .onConflict(oc =>
                oc.column("uri").doUpdateSet({
                    text: (eb) => eb.ref('excluded.text'),
                    textBlobId: (eb) => eb.ref('excluded.textBlobId'),
                    format: (eb) => eb.ref('excluded.format'),
                    selfLabels: (eb) => eb.ref('excluded.selfLabels')
                })
            )
            .execute()
    }

    if (contentDatasetLinks.length > 0) {
        // TO DO: Borrar datasets que se dejaron de usar
        await trx
            .insertInto('_ContentToDataset')
            .values(contentDatasetLinks)
            .onConflict(oc => oc.columns(['A', 'B']).doNothing())
            .execute()
    }
}


export const processPostsBatch: BatchRecordProcessor<Post.Record> = async (ctx, records) => {
    await ctx.kysely.transaction().execute(async (trx) => {
        await processRecordsBatch(trx, records)
        const referencedRefs: ATProtoStrongRef[] = records.reduce((acc, r) => {
            return [
                ...acc,
                ...(r.record.reply?.root ? [{uri: r.record.reply.root.uri, cid: r.record.reply.root.cid}] : []),
                ...(r.record.reply?.parent ? [{uri: r.record.reply.parent.uri, cid: r.record.reply.parent.cid}] : []),
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
                    datasetsUsed
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
                rootId: r.reply && r.reply.root ? r.reply.root.uri : null
            }
        })

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
    })
}


export async function batchIncrementReactionCounter(
    trx: Transaction<DB>,
    type: ReactionType,
    recordIds: string[]
) {
    const columnMap: Record<ReactionType, keyof DB['Record']> = {
        'app.bsky.feed.like': 'uniqueLikesCount',
        'app.bsky.feed.repost': 'uniqueRepostsCount',
        'ar.cabildoabierto.wiki.voteAccept': 'uniqueAcceptsCount',
        'ar.cabildoabierto.wiki.voteReject': 'uniqueRejectsCount',
    }

    const column = columnMap[type]

    if (!column) {
        throw new Error(`Unknown reaction type: ${type}`)
    }

    if(recordIds.length == 0) return

    await trx
        .updateTable('Record')
        .where('uri', 'in', recordIds)
        .set((eb) => ({
            [column]: eb(eb.ref(column), '+', 1)
        }))
        .execute()
}


function isReactionType(collection: string): collection is ReactionType {
    return [
        "app.bsky.feed.like",
        "app.bsky.feed.repost",
        "ar.cabildoabierto.wiki.voteAccept",
        "ar.cabildoabierto.wiki.voteReject"
    ].includes(collection)
}


export async function updateTopicsCurrentVersionBatch(trx: Transaction<DB>, topicIds: string[]) {
    // TO DO: Hacer en batch
    for (let i = 0; i < topicIds.length; i++) {
        const id = topicIds[i]
        console.log("Updating topic current version", id)
        const versions = await trx
            .selectFrom('Record')
            .innerJoin('Content', 'Content.uri', 'Record.uri')
            .innerJoin('TopicVersion', 'TopicVersion.uri', 'Content.uri')
            .select([
                'Record.uri',
                'Record.uniqueAcceptsCount',
                'Record.uniqueRejectsCount'
            ])
            .where('TopicVersion.topicId', '=', id)
            .where('Record.cid', 'is not', null)
            .orderBy('Record.created_at', 'asc')
            .execute()

        function getTopicCurrentVersionFromCounts(versions: {
            uri: string,
            uniqueAcceptsCount: number,
            uniqueRejectsCount: number
        }[]) {
            for (let i = versions.length - 1; i >= 0; i--) {
                if (versions[i].uniqueRejectsCount == 0) return i
            }
            return null
        }

        const currentVersion = getTopicCurrentVersionFromCounts(versions)

        const uri = currentVersion != null ? versions[currentVersion].uri : null

        await trx
            .updateTable('Topic')
            .set({currentVersionId: uri, lastEdit: new Date()})
            .where('id', '=', id)
            .execute()
    }
}


export const processReactionsBatch: BatchRecordProcessor<ReactionRecord> = async (ctx, records) => {
    await ctx.kysely.transaction().execute(async (trx) => {
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

        await batchIncrementReactionCounter(trx, reactionType, inserted.map(r => r.recordId))

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

            const topicIdsList = await trx
                .selectFrom("TopicVersion")
                .select(["topicId"])
                .where("uri", "in", records.map(r => r.ref.uri))
                .execute()

            await updateTopicsCurrentVersionBatch(trx, topicIdsList.map(r => r.topicId))
        }
    })
}


function parseRecords<T>(records: UserRepoElement[], validate: (r: UserRepoElement) => ValidationResult<T>): {
    ref: ATProtoStrongRef,
    record: T
}[] {
    const parsedRecords: { ref: ATProtoStrongRef, record: T }[] = []
    for (let i = 0; i < records.length; i++) {
        const r = records[i]
        const parsedRecord = parseRecord(r.record)
        const ref: ATProtoStrongRef = {uri: r.uri, cid: r.cid}

        const res = validate(parsedRecord)
        if (res.success) {
            parsedRecords.push({ref, record: res.value})
        }
    }
    return parsedRecords
}


export const processArticlesBatch: BatchRecordProcessor<Article.Record> = async (ctx, records, afterTransaction) => {
    const contents: { ref: ATProtoStrongRef, record: SyncContentProps }[] = records.map(r => ({
        record: {
            format: r.record.format,
            textBlob: {
                cid: getCidFromBlobRef(r.record.text),
                authorId: getDidFromUri(r.ref.uri)
            },
            selfLabels: isSelfLabels(r.record.labels) ? r.record.labels.values.map(l => l.val) : undefined
        },
        ref: r.ref
    }))

    const articles = records.map(r => ({
        uri: r.ref.uri,
        title: r.record.title
    }))

    await ctx.kysely.transaction().execute(async (trx) => {
        await processRecordsBatch(trx, records)
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

        if(afterTransaction){
            await afterTransaction(trx)
        }
    })
}


export const processTopicVersionsBatch: BatchRecordProcessor<TopicVersion.Record> = async (ctx, records) => {
    const contents: { ref: ATProtoStrongRef, record: SyncContentProps }[] = records.map(r => ({
        record: {
            format: r.record.format,
            textBlob: r.record.text ? {
                cid: getCidFromBlobRef(r.record.text),
                authorId: getDidFromUri(r.ref.uri)
            } : undefined
        },
        ref: r.ref
    }))

    const topics = records.map(r => ({
        id: r.record.id,
        lastEdit: new Date(),
        synonyms: []
    }))

    const topicVersions = records.map(r => ({
        uri: r.ref.uri,
        topicId: r.record.id,
        message: r.record.message ? r.record.message : undefined,
        props: r.record.props ? r.record.props as unknown as JsonArray : Prisma.JsonNull,
    }))

    await ctx.kysely.transaction().execute(async (trx) => {
        await processRecordsBatch(trx, records)
        await processContentsBatch(trx, contents)

        await trx
            .insertInto("Topic")
            .values(topics)
            .onConflict((oc) => oc.column("id").doUpdateSet({
                lastEdit: (eb) => (eb.ref("excluded.lastEdit"))
            }))
            .execute()

        const inserted = await trx
            .insertInto("TopicVersion")
            .values(topicVersions)
            .onConflict(oc => oc.column("uri").doUpdateSet({
                topicId: eb => eb.ref("excluded.topicId"),
                message: (eb) => eb.ref("excluded.message"),
                props: (eb: ExpressionBuilder<OnConflictDatabase<DB, "TopicVersion">, OnConflictTables<"TopicVersion">>) => eb.ref("excluded.props")
            }))
            .returning(["topicId"])
            .execute()

        await updateTopicsCurrentVersionBatch(trx, inserted.map(t => t.topicId))
    })
}


export const processDatasetsBatch: BatchRecordProcessor<Dataset.Record> = async (ctx, records) => {
    const datasets = records.map(({ref, record: r}) => ({
        uri: ref.uri,
        columns: r.columns.map(({name}: { name: string }) => (name)),
        title: r.name,
        description: r.description ? r.description : undefined
    }))

    const blobs = records.flatMap(r =>
        r.record.data?.map(b => ({
            cid: b.blob.ref.toString(),
            authorId: getDidFromUri(r.ref.uri)
        })) ?? []
    )

    const blocks = records.flatMap(r =>
        r.record.data?.map(b => ({
            cid: b.blob.ref.toString(),
            datasetId: r.ref.uri,
            format: b.format
        })) ?? []
    )

    await ctx.kysely.transaction().execute(async (trx) => {
        await processRecordsBatch(trx, records)

        await trx
            .insertInto("Dataset")
            .values(datasets)
            .onConflict((oc) => (
                oc.column("uri").doUpdateSet({
                    columns: (eb) => eb.ref("excluded.columns"),
                    title: (eb) => eb.ref("excluded.title"),
                    description: (eb) => eb.ref("excluded.description"),
                })
            ))
            .execute()

        await trx
            .insertInto("Blob")
            .values(blobs)
            .onConflict((oc) => oc.column("cid").doNothing())
            .execute()

        await trx
            .insertInto("DataBlock")
            .values(blocks)
            .onConflict((oc) => oc.column("cid").doNothing())
            .execute()
    })
}


export async function processDeleteReactionsBatch(ctx: AppContext, uris: string[]){
    // TO DO
    for(let i = 0; i < uris.length; i++){
        await processDeleteReaction(ctx, uris[i])
    }
}


export async function processDeleteTopicVersionsBatch(ctx: AppContext, uris: string[]){
    console.log("Deleting topic versions batch", uris.length)

    // New Kysely version
    await ctx.kysely.transaction().execute(async (trx) => {
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

        await updateTopicsCurrentVersionBatch(trx, topicIds.map(t => t.id))
    })
}



export async function processDeleteBatch(ctx: AppContext, uris: string[]){
    const byCollections = new Map<string, string[]>()
    uris.forEach(r => {
        const c = getCollectionFromUri(r)
        byCollections.set(c, [...(byCollections.get(c) ?? []), r])
    })
    const entries = Array.from(byCollections.entries())
    for (let i = 0; i < entries.length; i++){
        const [c, uris] = entries[i]
        if(isReactionType(c)){
            await processDeleteReactionsBatch(ctx, uris)
        } else if(isTopicVersion(c)){
            await processDeleteTopicVersionsBatch(ctx, uris)
        } else {
            const su = deleteRecordsDB(ctx, uris)
            await su.apply()
        }
    }
}


// !! En principio asumimos que todos los records son del mismo autor
export async function processCreateBatch(ctx: AppContext, records: UserRepoElement[], collection: string) {
    if (collection == "app.bsky.graph.follow") {
        const parsedRecords = parseRecords<Follow.Record>(records, Follow.validateRecord)
        await processFollowsBatch(ctx, parsedRecords)
    } else if (collection == "app.bsky.feed.post") {
        const parsedRecords = parseRecords<Post.Record>(records, Post.validateRecord)
        await processPostsBatch(ctx, parsedRecords)
    } else if (collection == "app.bsky.actor.profile") {
        const parsedRecord = parseRecord(records[0].record)
        const res = BskyProfile.validateRecord<BskyProfile.Record>(parsedRecord)
        if (res.success) {
            await processBskyProfile(ctx, {uri: records[0].uri, cid: records[0].cid}, res.value)
        }
    } else if (collection == "ar.com.cabildoabierto.profile") {
        await processCAProfile(ctx, {uri: records[0].uri, cid: records[0].cid}, records[0].record)
    } else if (collection == "ar.cabildoabierto.actor.caProfile") {
        const parsedRecord = parseRecord(records[0].record)
        const res = CAProfile.validateRecord<BskyProfile.Record>(parsedRecord)
        if (res.success) {
            await processCAProfile(ctx, {uri: records[0].uri, cid: records[0].cid}, res.value)
        }
    } else if (collection == "app.bsky.feed.like") {
        const parsedRecords = parseRecords<Like.Record>(records, Like.validateRecord)
        await processReactionsBatch(ctx, parsedRecords)
    } else if (collection == "app.bsky.feed.repost") {
        const parsedRecords = parseRecords<Repost.Record>(records, Repost.validateRecord)
        await processReactionsBatch(ctx, parsedRecords)
    } else if (collection == "ar.cabildoabierto.wiki.voteAccept") {
        const parsedRecords = parseRecords<VoteAccept.Record>(records, VoteAccept.validateRecord)
        await processReactionsBatch(ctx, parsedRecords)
    } else if (collection == "ar.cabildoabierto.wiki.voteReject") {
        const parsedRecords = parseRecords<VoteReject.Record>(records, VoteReject.validateRecord)
        await processReactionsBatch(ctx, parsedRecords)
    } else if (collection == "ar.cabildoabierto.feed.article") {
        const parsedRecords = parseRecords<Article.Record>(records, Article.validateRecord)
        await processArticlesBatch(ctx, parsedRecords)
    } else if (collection == "ar.cabildoabierto.wiki.topicVersion") {
        const parsedRecords = parseRecords<TopicVersion.Record>(records, TopicVersion.validateRecord)
        await processTopicVersionsBatch(ctx, parsedRecords)
    } else if (collection == "ar.cabildoabierto.data.dataset") {
        const parsedRecords = parseRecords<Dataset.Record>(records, Dataset.validateRecord)
        await processDatasetsBatch(ctx, parsedRecords)
    } else {
        console.log(`Batch update not implemented for ${collection}!`)
    }
}