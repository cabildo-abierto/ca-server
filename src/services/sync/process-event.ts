import {syncUser} from "./sync-user";
import {validRecord} from "./utils";
import {getUserMirrorStatus} from "./mirror-status";
import {CommitEvent, JetstreamEvent} from "#/lib/types";
import {getUri} from "#/utils/uri";
import {deleteRecords} from "#/services/delete";
import {Record as CAProfileRecord} from "#/lex-api/types/ar/cabildoabierto/actor/caProfile"
import {Record as DatasetRecord} from "#/lex-api/types/ar/cabildoabierto/data/dataset"
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {TopicProp, Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {Record as VoteRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/vote"
import {Record as PostRecord} from "#/lex-api/types/app/bsky/feed/post"
import {Record as LikeRecord} from "#/lex-api/types/app/bsky/feed/like"
import {Record as RepostRecord} from "#/lex-api/types/app/bsky/feed/repost"
import {Record as BskyProfileRecord} from "#/lex-api/types/app/bsky/actor/profile"
import {Record as FollowRecord} from "#/lex-api/types/app/bsky/graph/follow"
import {AppContext} from "#/index";
import {ATProtoStrongRef} from "#/lib/types";
import {getCollectionFromUri, getDidFromUri, getRkeyFromUri, splitUri} from "#/utils/uri";
import {JsonArray} from "@prisma/client/runtime/library";
import {Prisma} from '@prisma/client';
import {didToHandle} from "#/services/user/users";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {BlobRef} from "@atproto/lexicon";

function isProfile(collection: string){
    return collection == "ar.com.cabildoabierto.profile" || collection == "ar.cabildoabierto.actor.caProfile"
}

export async function processEvent(ctx: AppContext, e: JetstreamEvent) {
    if (e.kind == "commit") {
        const c = e as CommitEvent

        if (isProfile(c.commit.collection) && c.commit.rkey == "self") {
            await newUser(ctx, e.did, true)
            //const status = await getUserMirrorStatus(ctx, e.did)

            /*if (status == "Dirty" || status == "Failed") {
                await syncUser(ctx, e.did)
            }*/
            return
        }
    }

    if (e.kind == "commit") {
        const c = e as CommitEvent

        const uri = c.commit.uri ? c.commit.uri : "at://" + c.did + "/" + c.commit.collection + "/" + c.commit.rkey
        if (c.commit.operation == "create" || c.commit.operation == "update") {
            const record = {
                did: c.did,
                uri: uri,
                cid: c.commit.cid,
                collection: c.commit.collection,
                rkey: c.commit.rkey,
                record: c.commit.record
            }

            if (!validRecord(record)) {
                console.log("Invalid record")
                console.log(record)
                return
            }

            const ref = {uri, cid: c.commit.cid}
            const updates = await processCreate(ctx, ref, record.record)
            await ctx.db.$transaction(updates)
        } else if (c.commit.operation == "delete") {
            await processDelete(ctx, {
                did: c.did,
                collection: c.commit.collection,
                rkey: c.commit.rkey
            })
        }
    }
}


export async function processDelete(ctx: AppContext, r: { did: string, collection: string, rkey: string }) {
    await deleteRecords({ctx, uris: [getUri(r.did, r.collection, r.rkey)], atproto: false})
}


export type RecordProcessor<T> = (ctx: AppContext, ref: ATProtoStrongRef, record: T) => (any[] | Promise<any[]>)


function avatarUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/avatar/plain/" + did + "/" + cid + "@jpeg"
}

function bannerUrl(did: string, cid: string) {
    return "https://cdn.bsky.app/img/banner/plain/" + did + "/" + cid + "@jpeg"
}


export const processCAProfile: RecordProcessor<CAProfileRecord> = (ctx, ref, r) => {
    return [
        ctx.db.user.update({
            data: {
                CAProfileUri: ref.uri,
                inCA: true
            },
            where: {
                did: getDidFromUri(ref.uri)
            }
        })
    ]
}

export function getCidFromBlobRef(o?: BlobRef){
    if(!o) return undefined
    return o.ref.$link ? o.ref.$link : o.ref.toString()
}

export const processBskyProfile: RecordProcessor<BskyProfileRecord> = async (ctx, ref, r) => {
    const did = getDidFromUri(ref.uri)
    const avatarCid = getCidFromBlobRef(r.avatar)
    const avatar = avatarCid ? avatarUrl(did, avatarCid) : undefined
    const bannerCid = getCidFromBlobRef(r.banner)
    const banner = bannerCid ? bannerUrl(did, bannerCid) : undefined

    const handle = await didToHandle(ctx, did)

    if (handle == null) {
        throw Error("Error processing BskyProfile")
    }

    return [
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
    ]
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


export function newUser(ctx: AppContext, did: string, inCA: boolean) {
    if (inCA) {
        return ctx.db.user.upsert({
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
        return ctx.db.user.upsert({
            create: {did},
            update: {did},
            where: {did}
        })
    }
}

export function updatesForDirtyRecord(ctx: AppContext, link: { uri: string, cid?: string }) {
    const {uri, cid} = link
    const did = getDidFromUri(uri)
    const updates: any[] = [newUser(ctx, did, false)]
    const data = {
        uri: uri,
        cid: cid,
        authorId: did,
        rkey: getRkeyFromUri(uri),
        collection: getCollectionFromUri(uri)
    }
    updates.push(ctx.db.record.upsert({
        create: data,
        update: data,
        where: {
            uri: uri
        }
    }))
    return updates
}


export const processFollow: RecordProcessor<FollowRecord> = (ctx, ref, r) => {
    const updates: any[] = [newUser(ctx, r.subject, false)]
    const follow = {
        uri: ref.uri,
        userFollowedId: r.subject
    }
    updates.push(ctx.db.follow.upsert({
        create: follow,
        update: follow,
        where: {
            uri: ref.uri
        }
    }))
    return updates
}


export const processLike: RecordProcessor<LikeRecord> = (ctx, ref, r) => {
    const updates: any[] = updatesForDirtyRecord(ctx, r.subject)

    const like = {
        uri: ref.uri,
        likedRecordId: r.subject.uri
    }

    updates.push(ctx.db.like.upsert({
        create: like,
        update: like,
        where: {
            uri: ref.uri
        }
    }))

    return updates
}


export const processRepost: RecordProcessor<RepostRecord> = (ctx, ref, r) => {
    const updates: any[] = updatesForDirtyRecord(ctx, r.subject)
    const repost = {
        uri: ref.uri,
        repostedRecordId: r.subject.uri
    }

    updates.push(ctx.db.repost.upsert({
        create: repost,
        update: repost,
        where: {
            uri: ref.uri
        }
    }))

    return updates
}


type ContentProps = {
    format?: string
    text?: string
    textBlob?: {
        cid: string
        authorId: string
    }
    selfLabels?: string[]
}


export const processContent: RecordProcessor<ContentProps> = (ctx, ref, r: ContentProps) => {
    const content = {
        text: r.text,
        textBlobId: r.textBlob?.cid,
        uri: ref.uri,
        format: r.format,
        selfLabels: r.selfLabels
    }

    const contentUpd = ctx.db.content.upsert({
        create: content,
        update: content,
        where: {
            uri: ref.uri
        }
    })

    if (r.textBlob) {
        const blobUpd = ctx.db.blob.upsert({
            create: r.textBlob,
            update: r.textBlob,
            where: {
                cid: r.textBlob.cid
            }
        })
        return [blobUpd, contentUpd]
    } else {
        return [contentUpd]
    }
}


export const processPost: RecordProcessor<PostRecord> = async (ctx, ref, r) => {
    let updates: any[] = []
    if (r.reply) {
        updates = [...updates, ...updatesForDirtyRecord(ctx, r.reply.parent)]
        updates = [...updates, ...updatesForDirtyRecord(ctx, r.reply.root)]
    }

    const content: ContentProps = {
        format: "plain-text",
        text: r.text,
        selfLabels: isSelfLabels(r.labels) ? r.labels.values.map(l => l.val) : undefined
    }

    updates = [...updates, ...await processContent(ctx, ref, content)]

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

    return updates
}


export const processArticle: RecordProcessor<ArticleRecord> = async (ctx, ref, r) => {
    const content: ContentProps = {
        format: r.format,
        textBlob: {
            cid: r.text.ref.toString(),
            authorId: getDidFromUri(ref.uri)
        },
        selfLabels: isSelfLabels(r.labels) ? r.labels.values.map(l => l.val) : undefined
    }

    const updates: any[] = await processContent(ctx, ref, content)

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

    return updates
}


export const processTopicVersion: RecordProcessor<TopicVersionRecord> = async (ctx, ref, r) => {
    const content: ContentProps = {
        format: r.format,
        textBlob: r.text ? {
            cid: getCidFromBlobRef(r.text),
            authorId: getDidFromUri(ref.uri)
        } : undefined
    }
    let updates: any[] = await processContent(ctx, ref, content)

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

    return updates
}


export const processTopicVote: RecordProcessor<VoteRecord> = (ctx, ref, r) => {
    const updates: any[] = updatesForDirtyRecord(ctx, r.subject)
    if (r.value == "accept") {
        const topicVote = {
            uri: ref.uri,
            acceptedRecordId: r.subject.uri
        }
        updates.push(
            ctx.db.topicAccept.upsert({
                create: topicVote,
                update: topicVote,
                where: {uri: ref.uri}
            })
        )
    } else if (r.value == "reject") {
        const topicVote = {
            uri: ref.uri,
            rejectedRecordId: r.subject.uri
        }
        updates.push(
            ctx.db.topicReject.upsert({
                create: topicVote,
                update: topicVote,
                where: {uri: ref.uri}
            })
        )
    } else {
        throw Error("Invalid topic vote value: " + r.value)
    }
    return updates
}


const processDataset: RecordProcessor<DatasetRecord> = (ctx, ref, r) => {
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
            update: { cid: b.blob.ref.toString(), datasetId: ref.uri, format: b.format },
            create: { cid: b.blob.ref.toString(), datasetId: ref.uri, format: b.format },
            where: {cid: b.blob.ref.toString()}
        })
    );

    console.log("Dataset to db", blobs?.length, blocks?.length)

    return [
        ctx.db.dataset.upsert({
            create: dataset,
            update: dataset,
            where: {uri: ref.uri}
        }),
        ...blobs ?? [],
        ...blocks ?? []
    ]
}


/* TO DO:
export const processVisualization: RecordProcessor<VisualizationRecord> = (ctx, ref, r) => {
    const spec = JSON.parse(r.record.spec)

    const datasetUri: string | null = spec.metadata && spec.metadata.editorConfig ? spec.metadata.editorConfig.datasetUri : null

    let updates = []
    if(datasetUri){
        updates = updatesForDirtyRecord(ctx, {uri: datasetUri})
    }

    const blobCid: string = r.record.preview.ref.$link
    const blobDid = r.did
    const blob = {
        cid: blobCid,
        authorId: blobDid
    }

    const visualization = {
        uri: r.uri,
        spec: r.record.spec,
        datasetId: datasetUri,
        previewBlobCid: blobCid
    }

    return [
        ...updates,
        ctx.db.blob.upsert({
            create: blob,
            update: blob,
            where: {cid: blobCid}
        }),
        ctx.db.visualization.upsert({
            create: visualization,
            update: visualization,
            where: {uri: r.uri}
        })
    ]
}*/


const recordProcessors = new Map<string, RecordProcessor<any>>([
    ["app.bsky.graph.follow", processFollow],
    ["app.bsky.feed.like", processLike],
    ["app.bsky.feed.repost", processRepost],
    ["app.bsky.feed.post", processPost],
    ["ar.cabildoabierto.feed.article", processArticle],
    ["ar.cabildoabierto.actor.caProfile", processCAProfile],
    ["ar.com.cabildoabierto.profile", processCAProfile],
    ["app.bsky.actor.profile", processBskyProfile],
    ["ar.cabildoabierto.data.dataset", processDataset],
    ["ar.cabildoabierto.wiki.topicVersion", processTopicVersion],
    ["ar.cabildoabierto.wiki.vote", processTopicVote]
])


export const processCreate: RecordProcessor<any> = async (ctx, ref, record) => {
    const collection = getCollectionFromUri(ref.uri)
    const processor = recordProcessors.get(collection)
    try {
        if (processor) {
            let updates = processRecord(ctx, ref, record)
            return [...updates, ...await processor(ctx, ref, record)]
        } else {
            console.log("Couldn't find processor for collection", collection)
            return []
        }
    } catch (err) {
        console.log("Error processing record", ref.uri)
        console.log(err)
        return []
    }
}