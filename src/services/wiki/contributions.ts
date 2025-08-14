import {CAHandler} from "#/utils/handler"
import {AppContext} from "#/index";
import {Dataplane, getBlobKey} from "#/services/hydration/dataplane";
import {BlobRef} from "#/services/hydration/hydrate";
import {nodesCharDiff} from "#/services/wiki/diff";
import {decompress} from "#/utils/compression";
import {unique} from "#/utils/arrays";
import {isVersionAccepted} from "#/services/wiki/current-version";
import {getTopicVersionStatusFromReactions} from "#/services/monetization/author-dashboard";
import * as assert from "node:assert";


export const updateTopicContributionsHandler: CAHandler<{
    params: { id: string }
}, {}> = async (ctx, agent, {params}) => {
    const {id} = params
    await ctx.worker?.addJob(`update-topic-contributions`, {topicIds: [id]})
    return {data: {}}
}


function getMarkdown(v: {
    content: { text: string | null, textBlobId: string | null, format: string | null, record: { authorId: string } }
}, dataplane: Dataplane): string | null {
    let text: string | null = v.content.text
    const format = v.content.format
    if(!v.content.text && v.content.textBlobId){
        text = dataplane.textBlobs.get(getBlobKey({
            cid: v.content.textBlobId,
            authorId: v.content.record.authorId
        }))!
    }
    if(text == null) return null

    if (format == "markdown-compressed") {
        return decompress(text)
    } else if (format == "lexical-compressed" || !format) {
        try {
            const lexical = decompress(text)
            if (lexical.length == 0) {
                return ""
            } else {
                return null
            }
        } catch {
            console.log("Failed to decompress lexical content", text)
            return null
        }
    } else if (format == "plain-text") {
        return v.content.text
    } else if(format == "markdown"){
        return text
    } else {
        return null
    }
}


export async function updateAllTopicContributions(ctx: AppContext) {
    console.log("getting topic ids")
    const topicIds = (await ctx.kysely
        .selectFrom("Topic")
        .select("id")
        .execute()).map(t => t.id)
    console.log("updating topic contributions for topics", topicIds.length)

    await updateTopicContributions(ctx, topicIds)
}


export const updateTopicContributions = async (ctx: AppContext, topicIds: string[]) => {
    const t1 = Date.now()

    const batchSize = 500
    if(topicIds.length > batchSize){
        for(let i = 0; i < topicIds.length; i += batchSize ){
            console.log("Running update topic contributions for batch", i, "of", topicIds.length)
            await updateTopicContributions(
                ctx,
                topicIds.slice(i, i+batchSize)
            )
        }
        return
    }


    type TopicVersion = {
        uri: string
        authorship: boolean
        topicId: string
        topic: {
            protection: string
        }
        content: {
            text: string | null
            format: string | null
            textBlobId: string | null
            record: {
                authorId: string
                createdAt: Date
                author: {editorStatus: string}
                reactions: {uri: string, record: {author: {editorStatus: string}}}[]
            }
        }
    }

    if (!topicIds || !(topicIds instanceof Array) || topicIds.length == 0) return

    const versions: TopicVersion[] = await ctx.db.topicVersion.findMany({
        select: {
            uri: true,
            topicId: true,
            topic: {
                select: {
                    protection: true
                }
            },
            authorship: true,
            content: {
                select: {
                    text: true,
                    format: true,
                    textBlobId: true,
                    record: {
                        select: {
                            authorId: true,
                            author: {
                                select: {
                                    editorStatus: true
                                }
                            },
                            createdAt: true,
                            reactions: {
                                select: {
                                    uri: true,
                                    record: {
                                        select: {
                                            author: {
                                                select: {
                                                    editorStatus: true
                                                }
                                            }
                                        }
                                    }
                                }
                            }
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
        if (!e.content.textBlobId) return null
        if(e.content.text != null) return null
        console.log(e.topicId, e.uri, "has no text", e.content.text)
        return {
            cid: e.content.textBlobId,
            authorId: e.content.record.authorId
        }
    }).filter(x => x != null)

    const dataplane = new Dataplane(ctx)
    console.log("fetching text blobs for blobRefs", blobRefs.length)
    if(blobRefs.length > 25) throw Error(`too many blobs to fetch ${blobRefs.length}`)
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

    Array.from(versionsByTopic.entries()).forEach(([topicId, topicVersions]) => {
        let prev = ""
        let accCharsAdded = 0
        let monetizedCharsAdded = 0
        let prevAccepted = undefined
        const versionUpdates: Upd[] = []

        const acceptedMap = new Map<string, boolean>()

        let acceptedVersions = 0
        for (let i = 0; i < topicVersions.length; i++) {
            const v = topicVersions[i]
            const status = getTopicVersionStatusFromReactions(v.content.record.reactions.map(r => ({uri: r.uri, editorStatus: r.record.author.editorStatus})))
            const accepted = isVersionAccepted(
                v.content.record.author.editorStatus,
                v.topic.protection,
                status
            )
            acceptedMap.set(v.uri, accepted)
            if(accepted) acceptedVersions++

            let markdown = getMarkdown(v, dataplane)
            if(markdown == null){
                console.log("Warning: Couldn't find markdown for", v.uri)
                markdown = ""
            }

            const d = nodesCharDiff(
                prev.split("\n\n"),
                markdown.split("\n\n")
            )

            if(!accepted){
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
                continue
            }

            accCharsAdded += d.charsAdded
            if (v.authorship) {
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

        if(versionUpdates.length != topicVersions.length) throw Error("Faltan updates!")

        for (let i = 0; i < topicVersions.length; i++) {
            let monetized = 0
            const accepted = acceptedMap.get(versionUpdates[i].uri)
            if(accepted){
                if(topicVersions[i].authorship && monetizedCharsAdded > 0){
                    monetized += (versionUpdates[i].charsAdded / monetizedCharsAdded)*0.9
                }
                if(monetizedCharsAdded){
                    monetized += 0.1 / acceptedVersions
                } else {
                    monetized += 1.0 / acceptedVersions
                }
            }

            versionUpdates[i].contribution = JSON.stringify({
                all: versionUpdates[i].charsAdded / accCharsAdded,
                monetized
            })
        }
        updates = [...updates, ...versionUpdates]
    })


    if (updates.length > 0) {
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


export async function updateTopicContributionsRequired(ctx: AppContext) {
    console.log("getting topic versions")
    const tv = await ctx.kysely
        .selectFrom("TopicVersion")
        .where("TopicVersion.charsAdded", "is", null)
        .select("topicId")
        .execute()
    const topicIds = unique(tv.map(t => t.topicId))
    console.log("Required topic contribution updates:", topicIds.length)
    await updateTopicContributions(ctx, topicIds)
}