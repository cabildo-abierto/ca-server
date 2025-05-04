import { AppContext } from "#/index";
import {SyncRecordProps} from "#/lib/types";
import {getCollectionFromUri, getDidFromUri, getRkeyFromUri} from "#/utils/uri";
import {decompress} from "#/utils/compression";
import {getAllText} from "#/services/topic/diff";
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import { JsonArray } from "@prisma/client/runtime/library";
import { Prisma } from '@prisma/client';


export function processRecord(ctx: AppContext, r: SyncRecordProps) {
    const data = {
        uri: r.uri,
        cid: r.cid,
        rkey: r.rkey,
        createdAt: r.record.createdAt ? new Date(r.record.createdAt) : undefined,
        authorId: r.did,
        collection: r.collection,
        record: JSON.stringify(r.record)
    }
    return [ctx.db.record.upsert({
        create: data,
        update: data,
        where: {
            uri: r.uri
        }
    })]
}


export function newUser(ctx: AppContext, did: string, inCA: boolean){
    if(inCA){
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

export function newDirtyRecord(ctx: AppContext, link: {uri: string, cid?: string}){
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


export function processFollow(ctx: AppContext, r: SyncRecordProps){
    const updates: any[] = [newUser(ctx, r.record.subject, false)]
    const follow = {
        uri: r.uri,
        userFollowedId: r.record.subject
    }
    updates.push(ctx.db.follow.upsert({
        create: follow,
        update: follow,
        where: {
            uri: r.uri
        }
    }))
    return updates
}


export function processLike(ctx: AppContext, r: SyncRecordProps){
    const updates: any[] = newDirtyRecord(ctx, r.record.subject)

    const like = {
        uri: r.uri,
        likedRecordId: r.record.subject.uri
    }
    updates.push(ctx.db.like.upsert({
        create: like,
        update: like,
        where: {
            uri: r.uri
        }
    }))

    return updates
}


export function processRepost(ctx: AppContext, r: SyncRecordProps){
    const updates: any[] = newDirtyRecord(ctx, r.record.subject)
    const repost = {
        uri: r.uri,
        repostedRecordId: r.record.subject.uri
    }

    updates.push(ctx.db.repost.upsert({
        create: repost,
        update: repost,
        where: {
            uri: r.uri
        }
    }))

    return updates
}

export function processContent(ctx: AppContext, r: SyncRecordProps){
    function getNumWords(text?: string){
        if(text == undefined) return undefined
        if(r.collection != "ar.com.cabildoabierto.topic" && r.collection != "ar.com.cabildoabierto.article"){
            return text.split(" ").length
        } else if(r.record.format == "lexical-compressed") {
            return getAllText(decompress(text)).split(" ").length
        } else if(r.record.format == "markdown") {
            return text.length
        } else if(r.record.format == "markdown-compressed"){
            return decompress(text).length
        } else {
            return text.split(" ").length
        }
    }

    let text = undefined
    let blob = undefined
    if(r.record.text != null){
        if(r.record.text.ref){
            let blobCid: string = r.record.text.ref.toString()
            if(blobCid == "[object Object]"){
                blobCid = r.record.text.ref.$link
            }
            const blobDid = r.did

            blob = {
                cid: blobCid,
                authorId: blobDid
            }
        } else {
            text = r.record.text
        }
    }

    const content = {
        text: text,
        textBlobId: blob ? blob.cid : undefined,
        uri: r.uri,
        numWords: getNumWords(text),
        format: r.record.format
    }

    const contentUpd = ctx.db.content.upsert({
        create: content,
        update: content,
        where: {
            uri: r.uri
        }
    })

    if(blob){
        const blobUpd = ctx.db.blob.upsert({
            create: blob,
            update: blob,
            where: {
                cid: blob.cid
            }
        })
        return [blobUpd, contentUpd]
    } else {
        return [contentUpd]
    }
}

export function processPost(ctx: AppContext, r: SyncRecordProps){
    let updates: any[] = []
    if(r.record.reply){
        updates = [...updates, ...newDirtyRecord(ctx, r.record.reply.parent)]
        if(r.record.reply.root){
            updates = [...updates, ...newDirtyRecord(ctx, r.record.reply.root)]
        }
    }

    updates = [...updates, ...processContent(ctx, r)]

    const post = {
        facets: r.record.facets ? JSON.stringify(r.record.facets) : null,
        embed: r.record.embed ? JSON.stringify(r.record.embed) : null,
        uri: r.uri,
        replyToId: r.record.reply ? r.record.reply.parent.uri as string : null,
        rootId: r.record.reply && r.record.reply.root ? r.record.reply.root.uri : null,
        quote: r.record.quote ? r.record.quote : null
    }

    updates.push(ctx.db.post.upsert({
        create: post,
        update: post,
        where: {
            uri: r.uri
        }
    }))

    return updates
}


export function processArticle(ctx: AppContext, r: SyncRecordProps){
    const updates: any[] = processContent(ctx, r)

    const article = {
        uri: r.uri,
        title: r.record.title
    }

    updates.push(ctx.db.article.upsert({
        create: article,
        update: article,
        where: {
            uri: r.uri
        }
    }))

    return updates
}


export function processTopicVersion(ctx: AppContext, r: SyncRecordProps) {
    let updates: any[] = processContent(ctx, r)

    const record = r.record as TopicVersionRecord
    console.log("Processing topic version for", record.id)
    console.log("uri", r.uri)
    console.log("Props", record.props)

    const isNewCurrentVersion = true // TO DO: esto debería depender de los permisos del usuario, o no hacerse si preferimos esperar a un voto

    const topic = {
        id: record.id,
        lastEdit: new Date()
    }

    updates.push(ctx.db.topic.upsert({
        create: topic,
        update: topic,
        where: {id: record.id}
    }))

    const topicVersion = {
        uri: r.uri,
        topicId: record.id,
        message: record.message ? record.message : undefined,
        props: record.props ? record.props as unknown as JsonArray : Prisma.JsonNull,
    }

    updates.push(ctx.db.topicVersion.upsert({
        create: topicVersion,
        update: topicVersion,
        where: {
            uri: r.uri
        }
    }))

    if(isNewCurrentVersion){
        updates.push(
            ctx.db.topic.update({
                data: {
                    currentVersionId: r.uri
                },
                where: {
                    id: record.id
                }
            })
        )
    }

    return updates
}


export function processTopicVote(ctx: AppContext, r: SyncRecordProps){
    const updates: any = newDirtyRecord(ctx, r.record.subject)
    if(r.record.value == "accept"){
        const topicVote = {
            uri: r.uri,
            acceptedRecordId: r.record.subject.uri
        }
        updates.push(
            ctx.db.topicAccept.upsert({
                create: topicVote,
                update: topicVote,
                where: {uri: r.uri}
            })
        )
    } else if(r.record.value == "reject"){
        const topicVote = {
            uri: r.uri,
            rejectedRecordId: r.record.subject.uri
        }
        updates.push(
            ctx.db.topicReject.upsert({
                create: topicVote,
                update: topicVote,
                where: {uri: r.uri}
            })
        )
    } else {
        throw Error("Invalid topic vote value:", r.record.value)
    }
    return updates
}


export function processDataset(ctx: AppContext, r: SyncRecordProps){
    const dataset = {
        uri: r.uri,
        columns: r.record.columns.map(({name}: {name: string}) => (name)),
        title: r.record.title,
        description: r.record.description ? r.record.description : undefined
    }
    return [
        ctx.db.dataset.upsert({
            create: dataset,
            update: dataset,
            where: {uri: r.uri}
        })
    ]
}

export function processDataBlock(ctx: AppContext, r: SyncRecordProps){
    const blobCid: string = r.record.data.ref.$link
    const blobDid = r.did // los blobs siempre se almacenan en el mismo repo
    const blob = {
        cid: blobCid,
        authorId: blobDid
    }
    const block = {
        uri: r.uri,
        datasetId: r.record.dataset.uri as string,
        format: r.record.format as string,
        blobId: blobCid
    }
    const dirtyDataset = {
        columns: [], // un dataset sin columnas es inválido, lo usamos como placeholder
        title: "",
        uri: r.record.dataset.uri
    }
    return [
        ...newDirtyRecord(ctx, r.record.dataset),
        ctx.db.dataset.upsert({
            create: dirtyDataset,
            update: {},
            where: {uri: r.record.dataset.uri}
        }),
        ctx.db.blob.upsert({
            create: blob,
            update: blob,
            where: {cid: blobCid}
        }),
        ctx.db.dataBlock.upsert({
            create: block,
            update: block,
            where: {uri: r.uri}
        })
    ]
}

export function processVisualization(ctx: AppContext, r: SyncRecordProps){
    const spec = JSON.parse(r.record.spec)

    const datasetUri: string | null = spec.metadata && spec.metadata.editorConfig ? spec.metadata.editorConfig.datasetUri : null

    let updates = []
    if(datasetUri){
        updates = newDirtyRecord(ctx, {uri: datasetUri})
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
}