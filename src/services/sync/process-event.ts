import {ATProtoStrongRef, CommitEvent, JetstreamEvent} from "#/lib/types";
import {getCollectionFromUri, getDidFromUri, getRkeyFromUri, getUri, isTopicVersion, splitUri} from "#/utils/uri";
import * as CAProfile from "#/lex-api/types/ar/cabildoabierto/actor/caProfile"
import * as Dataset from "#/lex-api/types/ar/cabildoabierto/data/dataset"
import * as Article from "#/lex-api/types/ar/cabildoabierto/feed/article"
import * as TopicVersion from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import * as Post from "#/lex-api/types/app/bsky/feed/post"
import * as BskyProfile from "#/lex-api/types/app/bsky/actor/profile"
import * as Follow from "#/lex-api/types/app/bsky/graph/follow"
import * as Like from "#/lex-api/types/app/bsky/feed/like"
import * as Repost from "#/lex-api/types/app/bsky/feed/repost"
import * as VoteAccept from "#/lex-api/types/ar/cabildoabierto/wiki/voteAccept"
import * as VoteReject from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject"
import {isRecord as isVoteReject} from "#/lex-api/types/ar/cabildoabierto/wiki/voteReject"
import {AppContext} from "#/index";
import {JsonArray} from "@prisma/client/runtime/library";
import {Prisma} from '@prisma/client';
import {didToHandle} from "#/services/user/users";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {BlobRef} from "@atproto/lexicon";
import {isMain as isVisualizationEmbed, isDatasetDataSource} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {
    PrismaFunctionTransaction,
    PrismaTransactionClient,
    PrismaUpdate,
    SyncUpdate
} from "#/services/sync/sync-update";
import {
    deleteTopicVersionDB,
    getTopicIdFromTopicVersionUri,
    updateTopicCurrentVersion
} from "#/services/topic/current-version";
import {decrementReactionCounter, incrementReactionCounter, ReactionRecord} from "#/services/reactions/reactions";
import {isReactionCollection} from "#/utils/type-utils";
import {CID} from "multiformats/cid";
import {deleteRecordsDB} from "#/services/delete";
import {isTopicVote} from "#/services/topic/votes";

export type RecordProcessor<T> = (ctx: AppContext, ref: ATProtoStrongRef, record: T, addToTransaction?: PrismaUpdate[]) => SyncUpdate | Promise<SyncUpdate>


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
            const su = await processCreate(ctx, ref, record.record)
            await su.apply()
        } else if (c.commit.operation == "delete") {
            console.log(`Delete event: ${uri}`)
            const su = await processDelete(ctx, uri)
            await su.apply()
        }
    }
}


export async function processDelete(ctx: AppContext, uri: string): Promise<SyncUpdate> {
    const c = getCollectionFromUri(uri)

    if (isTopicVersion(c)) {
        const {su, error} = await deleteTopicVersionDB(ctx, uri)
        if (error || !su) throw Error(error)
        return su
    } else if (isReactionCollection(c)) {
        return await processDeleteReaction(ctx, uri)
    } else {
        return deleteRecordsDB(ctx, [uri])
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

export function updatesForDirtyRecord(db: PrismaTransactionClient, link: { uri: string, cid?: string }) {
    const {uri, cid} = link
    const did = getDidFromUri(uri)
    const updates: PrismaUpdate[] = [newUser(db, did, false)]
    const data = {
        uri: uri,
        cid: cid,
        authorId: did,
        rkey: getRkeyFromUri(uri),
        collection: getCollectionFromUri(uri)
    }
    updates.push(db.record.upsert({
        create: data,
        update: data,
        where: {
            uri: uri
        }
    }))
    return updates
}


export const processCAProfile: RecordProcessor<CAProfile.Record> = (ctx, ref, r) => {
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
    return u
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
    return su
}


export const processFollow: RecordProcessor<Follow.Record> = (ctx, ref, r) => {
    const su = new SyncUpdate(ctx.db)

    const updates: any[] = [
        ...processRecord(ctx, ref, r),
        newUser(ctx.db, r.subject, false)
    ]

    const follow = {
        uri: ref.uri,
        userFollowedId: r.subject
    }
    updates.push(
        ctx.db.follow.upsert({
            create: follow,
            update: follow,
            where: {
                uri: ref.uri
            }
        })
    )
    su.addUpdatesAsTransaction(updates)
    return su
}


type ContentProps = {
    format?: string
    text?: string
    textBlob?: {
        cid: string
        authorId: string
    }
    selfLabels?: string[]
    datasetsUsed?: string[]
}


export const processContent = (ctx: AppContext, ref: ATProtoStrongRef, r: ContentProps): PrismaUpdate[] => {
    const content = {
        text: r.text,
        textBlobId: r.textBlob?.cid,
        uri: ref.uri,
        format: r.format,
        selfLabels: r.selfLabels,
        datasetsUsed: {
            connect: r.datasetsUsed?.map(d => ({uri: d})) ?? []
        }
    }

    const updates: PrismaUpdate[] = []

    if (r.textBlob) {
        const blobUpd = ctx.db.blob.upsert({
            create: r.textBlob,
            update: r.textBlob,
            where: {
                cid: r.textBlob.cid
            }
        })
        updates.push(blobUpd)
    }

    updates.push(ctx.db.content.upsert({
        create: content,
        update: content,
        where: {
            uri: ref.uri
        }
    }))

    return updates
}


export const processPost: RecordProcessor<Post.Record> = async (ctx, ref, r) => {
    let updates: PrismaUpdate[] = []

    updates.push(...processRecord(ctx, ref, r))

    if (r.reply) {
        updates = [...updates, ...updatesForDirtyRecord(ctx.db, r.reply.parent)]
        updates = [...updates, ...updatesForDirtyRecord(ctx.db, r.reply.root)]
    }

    let datasetsUsed: string[] = []
    if(isVisualizationEmbed(r.embed) && isDatasetDataSource(r.embed.dataSource)){
        datasetsUsed.push(r.embed.dataSource.dataset)
    }

    const content: ContentProps = {
        format: "plain-text",
        text: r.text,
        selfLabels: isSelfLabels(r.labels) ? r.labels.values.map(l => l.val) : undefined,
        datasetsUsed
    }

    updates = [
        ...updates,
        ...processContent(ctx, ref, content)
    ]

    const post = {
        facets: r.facets ? JSON.stringify(r.facets) : null,
        embed: r.embed ? JSON.stringify(r.embed) : null,
        uri: ref.uri,
        replyToId: r.reply ? r.reply.parent.uri as string : null,
        rootId: r.reply && r.reply.root ? r.reply.root.uri : null
    }

    updates.push(ctx.db.post.upsert({
        create: post,
        update: post,
        where: {
            uri: ref.uri
        }
    }))

    const su = new SyncUpdate(ctx.db)
    su.addUpdatesAsTransaction(updates)
    return su
}


export const processArticle: RecordProcessor<Article.Record> = async (ctx, ref, r, addToTransaction = []) => {
    const content: ContentProps = {
        format: r.format,
        textBlob: {
            cid: getCidFromBlobRef(r.text),
            authorId: getDidFromUri(ref.uri)
        },
        selfLabels: isSelfLabels(r.labels) ? r.labels.values.map(l => l.val) : undefined
    }

    const updates: PrismaUpdate[] = [
        ...processRecord(ctx, ref, r),
        ...processContent(ctx, ref, content)
    ]

    const article = {
        uri: ref.uri,
        title: r.title
    }

    updates.push(ctx.db.article.upsert({
        create: article,
        update: article,
        where: {
            uri: ref.uri
        }
    }))

    updates.push(...addToTransaction)

    const su = new SyncUpdate(ctx.db)
    su.addUpdatesAsTransaction(updates)
    return su
}


export const processTopicVersion: RecordProcessor<TopicVersion.Record> = async (ctx, ref, r) => {
    const content: ContentProps = {
        format: r.format,
        textBlob: r.text ? {
            cid: getCidFromBlobRef(r.text),
            authorId: getDidFromUri(ref.uri)
        } : undefined
    }

    let updates: PrismaUpdate[] = [
        ...processRecord(ctx, ref, r),
        ...processContent(ctx, ref, content)
    ]

    const isNewCurrentVersion = true // TO DO: esto debería depender de los permisos del usuario, o no hacerse si preferimos esperar a un voto

    const topic = {
        id: r.id,
        lastEdit: new Date()
    }

    updates.push(ctx.db.topic.upsert({
        create: topic,
        update: topic,
        where: {id: r.id}
    }))

    const topicVersion = {
        uri: ref.uri,
        topicId: r.id,
        message: r.message ? r.message : undefined,
        props: r.props ? r.props as unknown as JsonArray : Prisma.JsonNull,
    }

    updates.push(ctx.db.topicVersion.upsert({
        create: topicVersion,
        update: topicVersion,
        where: {
            uri: ref.uri
        }
    }))

    if (isNewCurrentVersion) {
        updates.push(
            ctx.db.topic.update({
                data: {
                    currentVersionId: ref.uri
                },
                where: {
                    id: r.id
                }
            })
        )
    }

    const su = new SyncUpdate(ctx.db)
    su.addUpdatesAsTransaction(updates)
    return su
}


export const processDataset: RecordProcessor<Dataset.Record> = async (ctx, ref, r) => {
    const dataset = {
        uri: ref.uri,
        columns: r.columns.map(({name}: { name: string }) => (name)),
        title: r.name,
        description: r.description ? r.description : undefined
    }

    const authorId = getDidFromUri(ref.uri)

    const blobs = r.data?.map(b =>
        ctx.db.blob.upsert({
            update: {cid: b.blob.ref.toString(), authorId},
            create: {cid: b.blob.ref.toString(), authorId},
            where: {cid: b.blob.ref.toString()}
        })
    )

    const blocks = r.data?.map(b =>
        ctx.db.dataBlock.upsert({
            update: {cid: b.blob.ref.toString(), datasetId: ref.uri, format: b.format},
            create: {cid: b.blob.ref.toString(), datasetId: ref.uri, format: b.format},
            where: {cid: b.blob.ref.toString()}
        })
    );

    const updates: PrismaUpdate[] = [
        ...processRecord(ctx, ref, r),
        ctx.db.dataset.upsert({
            create: dataset,
            update: dataset,
            where: {uri: ref.uri}
        }),
        ...blobs ?? [],
        ...blocks ?? []
    ]

    const su = new SyncUpdate(ctx.db)
    su.addUpdatesAsTransaction(updates)
    return su
}


export const processReaction: RecordProcessor<ReactionRecord> = async (ctx, ref, r) => {
    // TO DO: Bastante seguro que no hace falta que esto sea una transaction


    const t: PrismaFunctionTransaction = async (db) => {
        // 1. Creamos el record de la reacción (si no estaba creado)
        const recordUpdates: PrismaUpdate[] = processRecord(ctx, ref, r)
        for (let i = 0; i < recordUpdates.length; i++) {
            await recordUpdates[i]
        }

        // 2. Creamos el record que recibió la reacción (si no estaba creado)
        const subjectRecordUpdates: PrismaUpdate[] = updatesForDirtyRecord(db, r.subject)
        for (let i = 0; i < subjectRecordUpdates.length; i++) {
            await subjectRecordUpdates[i]
        }

        // 3. Creamos la reacción
        const reaction = {uri: ref.uri, subjectId: r.subject.uri}
        await db.reaction.upsert({
            create: reaction,
            update: reaction,
            where: {uri: ref.uri}
        })

        // 5. Intentamos crear HasReacted
        try {
            await db.hasReacted.create({
                data: {
                    userId: getDidFromUri(ref.uri),
                    recordId: r.subject.uri,
                    reactionType: getCollectionFromUri(ref.uri)
                }
            })
        } catch {
            return
        }

        // 6. Si se logró crear, incrementamos el contador
        await incrementReactionCounter(db, r.$type, r.subject.uri)

        // 4. Caso topic vote
        if (isTopicVote(r.$type)) {
            if (isVoteReject(r)) {
                const vote = {uri: ref.uri, message: r.message, labels: r.labels}
                await db.voteReject.upsert({update: vote, create: vote, where: {uri: ref.uri}})
            }

            const id = await getTopicIdFromTopicVersionUri(db, r.subject.uri)
            if (id) {
                await updateTopicCurrentVersion(db, id)
            } else {
                throw Error("No se encontró el tema votado.")
            }
        }
    }
    const su = new SyncUpdate(ctx.db)
    su.addFunctionTransaction(t)
    return su
}


export async function processDeleteReaction(ctx: AppContext, uri: string): Promise<SyncUpdate> {
    /* Idea:
        Eliminamos todos los likes
        Borramos HasReacted
        Si lo logramos borrar, restamos 1 al contador.

        Asunción: Al borrar un like del protocolo se borran todos los likes del usuario al post.
        ¿Qué pasa si no se cumple eso?
        Si los likes se borran individualmente, los likes quedan zombies: el usuario no ve el corazón rojo y tampoco aparece en el contador.
     */
    // TO DO: Bastante seguro que no hace falta que esto sea una transaction
    const t = async (db: PrismaTransactionClient) => {
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
        await db.reaction.deleteMany({where: {uri: {in: uris}}})
        await db.record.deleteMany({where: {uri: {in: uris}}})

        console.log("removing reaction type", type)
        if (type == "ar.cabildoabierto.wiki.voteReject" || type == "ar.cabildoabierto.wiki.voteAccept") {
            const id = await getTopicIdFromTopicVersionUri(db, subjectId.subjectId)
            console.log("topic id", id)
            if (id) {
                await updateTopicCurrentVersion(db, id)
                console.log("done updating current version")
            } else {
                throw Error("No se encontró el tema votado.")
            }
        }
    }

    const su = new SyncUpdate(ctx.db)
    su.addFunctionTransaction(t)
    return su
}


function parseRecord(obj: any): any {

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
            if (res.success) return await processBskyProfile(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "app.bsky.feed.post") {
            const res = Post.validateRecord<Post.Record>(parsedRecord)
            if (res.success) return await processPost(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "app.bsky.feed.like") {
            const res = Like.validateRecord<Like.Record>(parsedRecord)
            if (res.success) return await processReaction(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "app.bsky.feed.repost") {
            const res = Repost.validateRecord<Repost.Record>(parsedRecord)
            if (res.success) return await processReaction(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "app.bsky.graph.follow") {
            const res = Follow.validateRecord<Follow.Record>(parsedRecord)
            if (res.success) return await processFollow(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.actor.caProfile") {
            const res = CAProfile.validateRecord<CAProfile.Record>(parsedRecord)
            if (res.success) return await processCAProfile(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.feed.article") {
            const res = Article.validateRecord<Article.Record>(parsedRecord)
            if (res.success) return await processArticle(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.wiki.topicVersion") {
            const res = TopicVersion.validateRecord<TopicVersion.Record>(parsedRecord)
            if (res.success) return await processTopicVersion(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.wiki.voteAccept") {
            const res = VoteAccept.validateRecord<VoteAccept.Record>(parsedRecord)
            if (res.success) return await processReaction(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.wiki.voteReject") {
            const res = VoteReject.validateRecord<VoteReject.Record>(parsedRecord)
            if (res.success) return await processReaction(ctx, ref, res.value)
            else console.log(res.error)
        } else if (collection == "ar.cabildoabierto.data.dataset") {
            const res = Dataset.validateRecord<Dataset.Record>(parsedRecord)
            if (res.success) return await processDataset(ctx, ref, res.value)
            else console.log(res.error)
        } else {
            console.log("Unknown collection", collection)
            return new SyncUpdate(ctx.db)
        }

        console.log("Validation failed.")
        return new SyncUpdate(ctx.db)
    } catch (err) {
        console.log("Error processing record", ref.uri)
        console.log(err)
        return new SyncUpdate(ctx.db)
    }
}