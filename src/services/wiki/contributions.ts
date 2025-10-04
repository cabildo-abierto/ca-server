import {CAHandler} from "#/utils/handler"
import {AppContext} from "#/setup";
import {Dataplane, getBlobKey} from "#/services/hydration/dataplane";
import {BlobRef} from "#/services/hydration/hydrate";
import {nodesCharDiff} from "#/services/wiki/diff";
import {decompress} from "#/utils/compression";
import {unique} from "#/utils/arrays";
import {isVersionAccepted} from "#/services/wiki/current-version";
import {getTopicVersionStatusFromReactions} from "#/services/monetization/author-dashboard";
import {getNumWords} from "#/services/wiki/content";
import { sql } from "kysely";


export const updateTopicContributionsHandler: CAHandler<{
    params: { id: string }
}, {}> = async (ctx, agent, {params}) => {
    const {id} = params
    await ctx.worker?.addJob(`update-topic-contributions`, [id])
    return {data: {}}
}


type TopicVersion = {
    uri: string
    topicId: string
    authorship: boolean
    protection: string
    text: string | null
    format: string | null
    dbFormat: string | null
    textBlobId: string | null
    authorId: string
    editorStatus: string
    created_at: Date
    reactions: {
        uri: string
        editorStatus: string
    }[] | null
}


function getMarkdown(v: TopicVersion, dataplane: Dataplane): string | null {
    let text: string | null = v.text
    let format = v.dbFormat
    if(!v.text && v.textBlobId){
        text = dataplane.textBlobs.get(getBlobKey({
            cid: v.textBlobId,
            authorId: v.authorId
        }))!
        format = v.format
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
        return v.text
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

    if (!topicIds || !(topicIds instanceof Array) || topicIds.length == 0) return

    const versions: TopicVersion[] = await ctx.kysely
        .selectFrom("TopicVersion as tv")
        .innerJoin("Topic as t", "t.id", "tv.topicId")
        .innerJoin("Content as c", "c.uri", "tv.uri")
        .innerJoin("Record as r", "r.uri", "tv.uri")
        .innerJoin("User as u", "u.did", "r.authorId")
        .leftJoin("Reaction", "Reaction.subjectId", "tv.uri")
        .leftJoin("Record as ReactionRecord", "Reaction.uri", "ReactionRecord.uri")
        .leftJoin("User as ReactionAuthor", "ReactionAuthor.did", "ReactionRecord.authorId")
        .select([
            "tv.uri",
            "tv.topicId",
            "tv.authorship",
            "t.protection",
            "c.text",
            "c.format",
            "c.dbFormat",
            "c.textBlobId",
            "r.authorId",
            "u.editorStatus",
            "r.created_at",
            eb => eb.fn.jsonAgg(
                sql<{ uri: string; editorStatus: string }>`json_build_object('uri', "Reaction"."uri", 'editorStatus', "ReactionAuthor"."editorStatus")`
            ).filterWhere("Reaction.uri", "is not", null).as("reactions")
        ])
        .groupBy([
            "tv.uri",
            "tv.topicId",
            "t.id",
            "tv.authorship",
            "t.protection",
            "c.text",
            "c.format",
            "c.dbFormat",
            "c.textBlobId",
            "r.authorId",
            "u.editorStatus",
            "r.created_at"
        ])
        .where("t.id", "in", topicIds)
        .orderBy("r.created_at asc")
        .execute()

    const blobRefs: BlobRef[] = versions.map(e => {
        if (!e.textBlobId) return null
        if(e.text != null) return null
        console.log(e.topicId, e.uri, "has no text", e.text)
        return {
            cid: e.textBlobId,
            authorId: e.authorId
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

    type ContentUpd = {uri: string, numWords: number, text: string, dbFormat: string}

    let updates: Upd[] = []
    let contentUpdates: ContentUpd[] = []

    Array.from(versionsByTopic.entries()).forEach(([topicId, topicVersions]) => {
        let prev = ""
        let accCharsAdded = 0
        let monetizedCharsAdded = 0
        let prevAccepted = undefined
        const versionUpdates: Upd[] = []
        const versionContentUpdates: ContentUpd[] = []

        const acceptedMap = new Map<string, boolean>()

        let acceptedVersions = 0
        for (let i = 0; i < topicVersions.length; i++) {
            const v = topicVersions[i]
            const status = getTopicVersionStatusFromReactions(v.reactions?.map(r => ({uri: r.uri, editorStatus: r.editorStatus})) ?? [])
            const accepted = isVersionAccepted(
                v.editorStatus,
                v.protection,
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
                versionContentUpdates.push({
                    uri: v.uri,
                    numWords: getNumWords(markdown, "markdown"),
                    text: markdown,
                    dbFormat: "markdown"
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
                prevAcceptedUri: prevAccepted,
            })
            versionContentUpdates.push({
                uri: v.uri,
                numWords: getNumWords(markdown, "markdown"),
                text: markdown,
                dbFormat: "markdown"
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
        updates.push(...versionUpdates)
        contentUpdates.push(...versionContentUpdates)
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

        await ctx.kysely
            .insertInto("Content")
            .values(contentUpdates.map(c => ({
                ...c,
                selfLabels: [],
                embeds: []
            })))
            .onConflict((oc) => oc.column('uri').doUpdateSet((eb) => ({
                numWords: eb.ref('excluded.numWords'),
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