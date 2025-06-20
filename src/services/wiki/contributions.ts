import { CAHandler } from "#/utils/handler"
import {AppContext} from "#/index";
import {Dataplane, getBlobKey} from "#/services/hydration/dataplane";
import {BlobRef} from "#/services/hydration/hydrate";
import {nodesCharDiff} from "#/services/wiki/diff";
import {decompress} from "#/utils/compression";
import {isVersionAccepted, isVersionMonetized} from "#/services/wiki/current-version";
import {getTopicHistory} from "#/services/wiki/history";



export const updateTopicContributionsHandler: CAHandler<{params: {id: string}}, {}> = async (ctx, agent, {params}) => {
    const {id} = params
    await ctx.worker?.addJob(`update-topic-contributions`, [id])
    return {data: {}}
}


function getMarkdown(v: {content: {textBlobId: string | null, format: string | null, record: {authorId: string}}}, dataplane: Dataplane): string | null {
    const blobCid = v.content.textBlobId
    let currentContent: string
    let currentFormat = v.content.format
    if(blobCid){
        currentContent = dataplane.textBlobs.get(getBlobKey({
            cid: blobCid,
            authorId: v.content.record.authorId
        }))!
    } else {
        return ""
    }

    if(currentFormat == "markdown-compressed"){
        return decompress(currentContent)
    } else if(currentFormat != "markdown"){
        if(currentFormat == "lexical-compressed" || !currentFormat){
            const lexical = decompress(currentContent)
            if(lexical.length == 0){
                return ""
            } else {
                return null
            }
        }
        return null
    }
    return currentContent
}


export const updateTopicContributions = async (ctx: AppContext, topicIds: string[]) => {
    const t1 = Date.now()

    type TopicVersion = {
        uri: string
        authorship: boolean
        topicId: string
        content: {
            format: string | null
            textBlobId: string | null
            record: {
                authorId: string
                createdAt: Date
            }
        }
    }

    const versions: TopicVersion[] = await ctx.db.topicVersion.findMany({
        select: {
            uri: true,
            topicId: true,
            authorship: true,
            content: {
                select: {
                    format: true,
                    textBlobId: true,
                    record: {
                        select: {
                            authorId: true,
                            createdAt: true
                        }
                    }
                }
            }
        },
        where: {
            topicId: {
                in: topicIds
            }
        },
        orderBy: {
            content: {
                record: {
                    createdAt: "asc"
                }
            }
        }
    })

    const blobRefs: BlobRef[] = versions.map(e => {
        if(!e.content.textBlobId) return null
        return {
            cid: e.content.textBlobId,
            authorId: e.content.record.authorId
        }
    }).filter(x => x != null)

    const dataplane = new Dataplane(ctx)
    await dataplane.fetchTextBlobs(blobRefs)

    const versionsByTopic = new Map<string, TopicVersion[]>()

    versions.forEach(v => {
        versionsByTopic.set(v.topicId, [...(versionsByTopic.get(v.topicId) ?? []), v])
    })

    type Upd = {
        uri: string
        topicId: string
        charsAdded: number
        charsDeleted: number
        accCharsAdded: number
        contribution?: string
        diff: string
        prevAcceptedUri: string | undefined
    }

    let updates: Upd[] = []

    versionsByTopic.entries().forEach(([topicId, topicVersions]) => {
        let prev = ""
        let accCharsAdded = 0
        let monetizedCharsAdded = 0
        let prevAccepted = undefined
        const versionUpdates: Upd[] = []

        for(let i = 0; i < topicVersions.length; i++){
            const v = topicVersions[i]

            const markdown = getMarkdown(v, dataplane)
            if(markdown == null) {
                continue
            }

            const d = nodesCharDiff(prev.split("\n\n"), markdown.split("\n\n"))
            if(d == null) {
                console.log(`Error computing diff between versions ${i} and ${i-1} of ${topicId}`)
                return
            }

            accCharsAdded += d.charsAdded
            if(v.authorship){
                monetizedCharsAdded += d.charsAdded
            }
            versionUpdates.push({
                uri: v.uri,
                charsAdded: d.charsAdded,
                charsDeleted: d.charsDeleted,
                accCharsAdded: accCharsAdded,
                diff: JSON.stringify(d),
                topicId,
                prevAcceptedUri: prevAccepted
            })
            prev = markdown
            prevAccepted = v.uri
        }

        for(let i = 0; i < versionUpdates.length; i++){
            versionUpdates[i].contribution = JSON.stringify({
                all: versionUpdates[i].charsAdded / accCharsAdded,
                monetized: versionUpdates[i].charsAdded / monetizedCharsAdded
            })
        }
        updates = [...updates, ...versionUpdates]
    })


    if(updates.length > 0){
        await ctx.kysely
            .insertInto("TopicVersion")
            .values(updates)
            .onConflict((oc) => oc.column('uri').doUpdateSet((eb) => ({
                charsAdded: eb.ref('excluded.charsAdded'),
                charsDeleted: eb.ref('excluded.charsDeleted'),
                accCharsAdded: eb.ref('excluded.accCharsAdded'),
                contribution: eb.ref('excluded.contribution'),
                diff: eb.ref('excluded.diff'),
                prevAcceptedUri: eb.ref('excluded.prevAcceptedUri'),
            })))
            .execute()
    }

    console.log("Done after", Date.now() - t1)
}