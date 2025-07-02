import {ATProtoStrongRef, CommitEvent, JetstreamEvent} from "#/lib/types";
import {getCollectionFromUri, getDidFromUri, getUri, isTopicVersion, splitUri} from "#/utils/uri";
import * as CAProfile from "#/lex-api/types/ar/cabildoabierto/actor/caProfile"
import * as Post from "#/lex-api/types/app/bsky/feed/post"
import * as BskyProfile from "#/lex-api/types/app/bsky/actor/profile"
import * as Follow from "#/lex-api/types/app/bsky/graph/follow"
import * as Like from "#/lex-api/types/app/bsky/feed/like"
import * as Repost from "#/lex-api/types/app/bsky/feed/repost"
import * as Dataset from "#/lex-api/types/ar/cabildoabierto/data/dataset"
import * as Article from "#/lex-api/types/ar/cabildoabierto/feed/article"
import * as TopicVersion from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import * as VoteAccept from "#/lex-api/types/ar/cabildoabierto/wiki/voteAccept"
import * as VoteReject from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject"
import {AppContext} from "#/index";
import {didToHandle} from "#/services/user/users";
import {BlobRef} from "@atproto/lexicon";
import {
    PrismaTransactionClient,
    SyncUpdate
} from "#/services/sync/sync-update";
import {
    processDeleteTopicVersion,
    getTopicIdFromTopicVersionUri,
    updateTopicCurrentVersion
} from "#/services/wiki/current-version";
import {decrementReactionCounter, ReactionRecord} from "#/services/reactions/reactions";
import {isReactionCollection} from "#/utils/type-utils";
import {CID} from "multiformats/cid";
import {deleteRecordsDB} from "#/services/delete";
import {
    addUpdateContributionsJobForTopics,
    processArticlesBatch, processDatasetsBatch,
    processFollowsBatch,
    processPostsBatch,
    processReactionsBatch, processTopicVersionsBatch
} from "#/services/sync/process-batch";
import {Transaction} from "kysely";
import {DB} from "../../../prisma/generated/types";
import {ArticleEmbed} from "#/lex-api/types/ar/cabildoabierto/feed/article"

export type RecordProcessor<T> = (ctx: AppContext, ref: ATProtoStrongRef, record: T, afterTransaction?: (trx: Transaction<DB>) => Promise<void>) => void | Promise<void>


function isProfile(collection: string) {
    return collection == "ar.com.cabildoabierto.profile" || collection == "ar.cabildoabierto.actor.caProfile"
}

export async function processEvent(ctx: AppContext, e: JetstreamEvent) {
    if (e.kind == "commit") {
        const c = e as CommitEvent

        if (isProfile(c.commit.collection) && c.commit.rkey == "self") {
            await newUser(ctx.db, e.did, true)
            //const status = await getUserMirrorStatus(ctx, e.did)

            /*if (status == "Dirty" || status == "Failed") {
                await syncUser(ctx, e.did)
            }*/
            return
        }
    }

    if (e.kind == "commit") {
        const c = e as CommitEvent

        const uri = c.commit.uri ? c.commit.uri : getUri(c.did, c.commit.collection, c.commit.rkey)
        if (c.commit.operation == "create" || c.commit.operation == "update") {
            const record = {
                did: c.did,
                uri: uri,
                cid: c.commit.cid,
                collection: c.commit.collection,
                rkey: c.commit.rkey,
                record: c.commit.record
            }

            console.log("Commit event:", uri)
            const ref = {uri, cid: c.commit.cid}
            await processCreate(ctx, ref, record.record)
        } else if (c.commit.operation == "delete") {
            console.log(`Delete event: ${uri}`)
            await processDelete(ctx, uri)
        }
    }
}


export async function processDelete(ctx: AppContext, uri: string) {
    const c = getCollectionFromUri(uri)

    if (isTopicVersion(c)) {
        await processDeleteTopicVersion(ctx, uri)

    } else if (isReactionCollection(c)) {
        await processDeleteReaction(ctx, uri)
    } else {
        const su = deleteRecordsDB(ctx, [uri])
        await su.apply()
    }
}


function avatarUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/avatar/plain/" + did + "/" + cid + "@jpeg"
}

function bannerUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/banner/plain/" + did + "/" + cid + "@jpeg"
}


export function getCidFromBlobRef(o: BlobRef) {
    return o.ref.toString()
}


export function processRecord(ctx: AppContext, ref: ATProtoStrongRef, record: any) {
    const {did, collection, rkey} = splitUri(ref.uri)
    const data = {
        uri: ref.uri,
        cid: ref.cid,
        rkey,
        collection,
        createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
        authorId: did,
        record: JSON.stringify(record)
    }
    return [ctx.db.record.upsert({
        create: data,
        update: data,
        where: {
            uri: ref.uri
        }
    })]
}


export function newUser(db: PrismaTransactionClient, did: string, inCA: boolean) {
    if (inCA) {
        return db.user.upsert({
            create: {
                did: did,
                inCA: true
            },
            update: {
                inCA: true
            },
            where: {
                did: did
            }
        })
    } else {
        return db.user.upsert({
            create: {did},
            update: {did},
            where: {did}
        })
    }
}


export const processCAProfile: RecordProcessor<CAProfile.Record> = async (ctx, ref, r) => {
    const u = new SyncUpdate(ctx.db)
    u.addUpdatesAsTransaction([
        ...processRecord(ctx, ref, r),
        ctx.db.user.update({
            data: {
                CAProfileUri: ref.uri,
                inCA: true
            },
            where: {
                did: getDidFromUri(ref.uri)
            }
        })
    ])
    await u.apply()
}

export const processBskyProfile: RecordProcessor<BskyProfile.Record> = async (ctx, ref, r) => {
    const did = getDidFromUri(ref.uri)
    const avatarCid = r.avatar ? getCidFromBlobRef(r.avatar) : undefined
    const avatar = avatarCid ? avatarUrl(did, avatarCid) : undefined
    const bannerCid = r.banner ? getCidFromBlobRef(r.banner) : undefined
    const banner = bannerCid ? bannerUrl(did, bannerCid) : undefined

    const handle = await didToHandle(ctx, did)

    if (handle == null) {
        throw Error("Error processing BskyProfile")
    }

    const su = new SyncUpdate(ctx.db)
    su.addUpdatesAsTransaction([
        ...processRecord(ctx, ref, r),
        ctx.db.user.update({
            data: {
                description: r.description ? r.description : undefined,
                displayName: r.displayName ? r.displayName : undefined,
                avatar,
                banner,
                handle
            },
            where: {
                did: did
            }
        })
    ])
    await su.apply()
}


export const processFollow: RecordProcessor<Follow.Record> = async (ctx, ref, r) => {
    await processFollowsBatch(ctx, [{ref, record: r}])
}


export type SyncContentProps = {
    format?: string
    text?: string
    textBlob?: {
        cid: string
        authorId: string
    }
    selfLabels?: string[]
    datasetsUsed?: string[]
    embeds: ArticleEmbed[]
}

export const processPost: RecordProcessor<Post.Record> = async (ctx, ref, r) => {
    await processPostsBatch(ctx, [{ref, record: r}])
}


export const processArticle: RecordProcessor<Article.Record> = async (ctx, ref, r, afterTransaction) => {
    await processArticlesBatch(ctx, [{ref, record: r}], afterTransaction)
}


export const processTopicVersion: RecordProcessor<TopicVersion.Record> = async (ctx, ref, r) => {
    await processTopicVersionsBatch(ctx, [{ref, record: r}])
}


export const processDataset: RecordProcessor<Dataset.Record> = async (ctx, ref, r) => {
    await processDatasetsBatch(ctx, [{ref, record: r}])
}


export const processReaction: RecordProcessor<ReactionRecord> = async (ctx, ref, r) => {
    await processReactionsBatch(ctx, [{ref, record: r}])
}


export async function processDeleteReaction(ctx: AppContext, uri: string) {
    /* Idea:
        Eliminamos todos los likes
        Borramos HasReacted
        Si lo logramos borrar, restamos 1 al contador.

        Asunción: Al borrar un like del protocolo se borran todos los likes del usuario al post.
        ¿Qué pasa si no se cumple eso?
        Si los likes se borran individualmente, los likes quedan zombies: el usuario no ve el corazón rojo y tampoco aparece en el contador.
     */
    // TO DO: Bastante seguro que no hace falta que esto sea una transaction
    const id = await ctx.db.$transaction(async (db) => {
        const type = getCollectionFromUri(uri)
        if (!isReactionCollection(type)) return

        // 1. Obtenemos el subjectId
        const subjectId = await db.reaction.findFirst({
            select: {
                subjectId: true
            },
            where: {
                uri: uri
            }
        })
        if (!subjectId || !subjectId.subjectId) return // No se encontró la reacción

        // 2. Intentamos borrar HasReacted y si lo logramos restamos 1
        try {
            const deleted = await db.hasReacted.deleteMany({
                where: {
                    userId: getDidFromUri(uri),
                    reactionType: type,
                    recordId: subjectId.subjectId
                }
            })
            if (deleted.count > 0) {
                await decrementReactionCounter(db, type, subjectId.subjectId)
            }
        } catch {
        }

        // 3. Eliminamos todas las reacciones del mismo tipo y sus records.
        const uris = (await db.reaction.findMany({
            select: {
                uri: true
            },
            where: {
                subjectId: subjectId.subjectId,
                record: {
                    collection: type,
                    authorId: getDidFromUri(uri)
                },
            }
        })).map(r => r.uri)

        if (type == "ar.cabildoabierto.wiki.voteReject") await db.voteReject.deleteMany({where: {uri: {in: uris}}})
        await db.notification.deleteMany({where: {causedByRecordId: {in: uris}}})
        await db.reaction.deleteMany({where: {uri: {in: uris}}})
        await db.record.deleteMany({where: {uri: {in: uris}}})

        if (type == "ar.cabildoabierto.wiki.voteReject" || type == "ar.cabildoabierto.wiki.voteAccept") {
            const {did, rkey} = splitUri(subjectId.subjectId)
            const id = await getTopicIdFromTopicVersionUri(db, did, rkey)
            if (id) {
                await updateTopicCurrentVersion(db, id)
                return id
            } else {
                throw Error("No se encontró el tema votado.")
            }
        }
    })
    if(id) {
        await addUpdateContributionsJobForTopics(ctx, [id])
    }
}


export function parseRecord(obj: any): any {

    if (Array.isArray(obj)) {
        return obj.map(parseRecord);
    }

    if (obj && typeof obj === 'object') {
        if (obj.$type === 'blob') {
            if (obj.ref?.$link) {
                const cid = CID.parse(obj.ref.$link);
                return new BlobRef(cid, obj.mimeType, obj.size)
            } else {
                throw Error("Invalid blob object")
            }
        }

        const newObj: any = {};
        for (const key in obj) {
            newObj[key] = parseRecord(obj[key]);
        }

        return newObj
    }

    return obj
}


// record es un json que viene de Jetstream
export const processCreate: RecordProcessor<any> = async (ctx, ref, record) => {
    const collection = getCollectionFromUri(ref.uri)
    try {
        const parsedRecord = parseRecord(record)
        if (collection == "app.bsky.actor.profile") {
            const res = BskyProfile.validateRecord<BskyProfile.Record>(parsedRecord)
            if (res.success) {
                await processBskyProfile(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "app.bsky.feed.post") {
            const res = Post.validateRecord<Post.Record>(parsedRecord)
            if (res.success) {
                await processPost(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "app.bsky.feed.like") {
            const res = Like.validateRecord<Like.Record>(parsedRecord)
            if (res.success) {
                await processReaction(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "app.bsky.feed.repost") {
            const res = Repost.validateRecord<Repost.Record>(parsedRecord)
            if (res.success) {
                await processReaction(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "app.bsky.graph.follow") {
            const res = Follow.validateRecord<Follow.Record>(parsedRecord)
            if (res.success) {
                await processFollow(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.actor.caProfile") {
            const res = CAProfile.validateRecord<CAProfile.Record>(parsedRecord)
            if (res.success) {
                await processCAProfile(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "ar.com.cabildoabierto.profile") {
            await processCAProfile(ctx, ref, parsedRecord)
            return
        } else if (collection == "ar.cabildoabierto.feed.article") {
            const res = Article.validateRecord<Article.Record>(parsedRecord)
            if (res.success) {
                await processArticle(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.wiki.topicVersion") {
            const res = TopicVersion.validateRecord<TopicVersion.Record>(parsedRecord)
            if (res.success) {
                await processTopicVersion(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.wiki.voteAccept") {
            const res = VoteAccept.validateRecord<VoteAccept.Record>(parsedRecord)
            if (res.success) {
                await processReaction(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.wiki.voteReject") {
            const res = VoteReject.validateRecord<VoteReject.Record>(parsedRecord)
            if (res.success) {
                await processReaction(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.data.dataset") {
            const res = Dataset.validateRecord<Dataset.Record>(parsedRecord)
            if (res.success) {
                await processDataset(ctx, ref, res.value)
                return
            }
            else console.log(res.error)
        } else {
            console.log("Unknown collection", collection)
            return
        }

        console.log(`Validation failed for ${ref.uri}.`)
        console.log("Parsed record", parsedRecord)
    } catch (err) {
        console.log("Error processing record", ref.uri)
        console.log(err)
    }
}