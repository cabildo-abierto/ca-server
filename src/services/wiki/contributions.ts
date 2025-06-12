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
    console.log("adding job", id)
    await ctx.queue.add(`update-topic-contributions:${id}`, {id})
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


export const updateTopicContributions = async (ctx: AppContext, id: string) => {
    const t1 = Date.now()

    const history = await getTopicHistory(ctx.db, id)
    history.versions = history.versions.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    const versions = await ctx.db.topicVersion.findMany({
        select: {
            uri: true,
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
            topicId: id
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

    let updates: {
        uri: string
        topicId: string
        charsAdded: number
        charsDeleted: number
        accCharsAdded: number
        contribution?: string
        diff: string
        prevAcceptedUri: string | undefined
    }[] = []

    let prev = ""
    let accCharsAdded = 0
    let monetizedCharsAdded = 0
    let prevAccepted = undefined
    for(let i = 0; i < versions.length; i++){
        const v = versions[i]
        const vH = history.versions.find(e => e.uri == versions[i].uri)
        if (!vH || !isVersionAccepted(vH.status)) continue

        const markdown = getMarkdown(v, dataplane)
        if(markdown == null) {
            console.log(`La versión ${i} no se pudo transformar a markdown.`)
            console.log("content", v.content)
            continue
        }

        const d = nodesCharDiff(prev.split("\n\n"), markdown.split("\n\n"))
        if(d == null) {
            console.log(`Error computing diff between versions ${i} and ${i-1} of ${id}`)
            return
        }

        accCharsAdded += d.charsAdded
        if(isVersionMonetized(vH)){
            monetizedCharsAdded += d.charsAdded
        }
        console.log(`Version ${i} prevAccepted ${prevAccepted}`)
        updates.push({
            uri: versions[i].uri,
            charsAdded: d.charsAdded,
            charsDeleted: d.charsDeleted,
            accCharsAdded: accCharsAdded,
            diff: JSON.stringify(d),
            topicId: id,
            prevAcceptedUri: prevAccepted
        })
        prev = markdown
        prevAccepted = v.uri
    }

    for(let i = 0; i < updates.length; i++){
        updates[i].contribution = JSON.stringify({
            all: updates[i].charsAdded / accCharsAdded,
            monetized: updates[i].charsAdded / monetizedCharsAdded
        })
    }

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