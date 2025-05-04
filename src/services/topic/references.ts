import {cleanText} from "#/utils/strings";
import {AppContext} from "#/index";
import {gett, unique} from "#/utils/arrays";
import {decompress} from "#/utils/compression";
import {CAHandler} from "#/utils/handler";
import {getTopicSynonyms} from "#/services/topic/utils";
import {getCollectionFromUri, getDidFromUri, isPost} from "#/utils/uri";
import {BlobRef} from "#/services/hydration/hydrate";
import {fetchTextBlobs} from "#/services/blob";
import {formatIsoDate} from "#/utils/dates";


function getSynonymRegex(synonym: string){
    const escapedKey = cleanText(synonym).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(`\\b${escapedKey}\\b`, 'gi')
}


function countSynonymInText(regex: RegExp, textCleaned: string): number {
    const matches = textCleaned.match(regex);

    return matches ? matches.length : 0;
}


export const updateReferencesHandler: CAHandler = async (ctx, agent, {}) => {
    await ctx.queue.add("update-references", {})

    return {data: {}}
}


export async function getContentsForReferenceUpdate(ctx: AppContext, since: Date){
    return ctx.db.record.findMany({
        select: {
            uri: true,
            createdAt: true,
            content: {
                select: {
                    text: true,
                    textBlobId: true,
                    format: true,
                    article: {
                        select: {
                            title: true
                        }
                    }
                }
            }
        },
        where: {
            createdAt: {
                gt: since
            },
            content: {
                isNot: null
            }
        },
        orderBy: {
            createdAt: "asc"
        }
    })
}


export async function getLastReferencesUpdate(ctx: AppContext){
    const lastUpdateStr = await ctx.ioredis.get("last-references-update")
    return lastUpdateStr ? new Date(lastUpdateStr) : new Date(0)
}


export async function setLastReferencesUpdate(ctx: AppContext, date: Date){
    await ctx.ioredis.set("last-references-update", date.toISOString())
    console.log("Last references update set to", formatIsoDate(date))
}


export async function updateReferencesForNewContents(ctx: AppContext) {
    const lastUpdate = await getLastReferencesUpdate(ctx)

    const contents = await getContentsForReferenceUpdate(ctx, lastUpdate)
    if(contents.length == 0) {
        console.log("No new contents, skipping")
        return
    }
    console.log("Got new contents", contents.length)

    const synonymsMap = await getSynonymsToTopicsMap(ctx)
    await updateReferencesForContentsAndTopics(ctx, contents, synonymsMap)
}


async function updateReferencesForContentsAndTopics(ctx: AppContext, contents: ContentProps[], synonymsMap: SynonymsMap){
    const batchSize = 100
    for(let i = 0; i < contents.length; i += batchSize){
        console.log("Updating references for new contents", i, "-", i+batchSize, "of", contents.length)
        const texts = await getContentsText(ctx, contents.slice(i, i+batchSize), 10)
        await applyReferencesUpdate(ctx, contents.slice(i, i+batchSize), texts, synonymsMap)
    }
}


function getTopicsReferencedInText(text: string, content: ContentProps, synonymsMap: Map<string, {topics: Set<string>, regex: RegExp}>){
    if(content.content?.article?.title) text += content.content.article.title
    const textCleaned = cleanText(text)
    const refs: {topicId: string, count: number}[] = []

    synonymsMap.values().forEach(({topics, regex}) => {
        const count = countSynonymInText(regex, textCleaned)
        if(count > 0){
            topics.forEach(t => refs.push({topicId: t, count}))
        }
    })

    return refs
}

type SynonymsMap = Map<string, {topics: Set<string>, regex: RegExp}>

export async function applyReferencesUpdate(ctx: AppContext, contents: ContentProps[], texts: string[], synonymsMap: SynonymsMap) {
    const contentUris: string[] = []
    const placeholders: string[] = []
    const values: (string | number)[] = []

    console.log("Analyzing references...")
    const t1 = Date.now()
    for(let i = 0; i < contents.length; i++){
        const c = contents[i]
        const text = texts[i]

        const references: {topicId: string, count: number}[] = getTopicsReferencedInText(text, c, synonymsMap)
        references.forEach(r => {
            console.log(`Found reference! URI: ${c.uri}. Topic: ${r.topicId}. Count: ${r.count}`)
        })
        references.forEach(r => {
            contentUris.push(c.uri)
            placeholders.push(`(uuid_generate_v4(), $${values.length + 1}, $${values.length + 2}, 'Weak', $${values.length + 3})`)
            values.push(c.uri, r.topicId, r.count)
        })
    }
    const t2 = Date.now()
    console.log("Done after", t2-t1)

    try {
        console.log("Inserting", contentUris.length, "references...")
        if(contentUris.length == 0) return
        const t1 = Date.now()
        // TO DO: Borrar las referencias que no estén más
        await ctx.db.$executeRawUnsafe(
            `
                INSERT INTO "Reference" (id, "referencingContentId", "referencedTopicId", type, count)
                VALUES ${placeholders.join(", ")}
                    ON CONFLICT DO NOTHING
            `,
            ...values
        )
        const t2 = Date.now()
        console.log("Updates applied after", t2-t1)
    } catch (e) {
        console.log("Error applying references update")
        console.log(e)
        throw e
    }
}

type ContentProps = {
    uri: string
    content: {
        text: string | null
        textBlobId: string | null
        format: string | null
        article: {
            title: string
        } | null
    } | null
}


function isCompressed(format: string | null){
    if(!format) return true
    return ["lexical-compressed", "markdown-compressed"].includes(format)
}


export async function getContentsText(ctx: AppContext, contents: ContentProps[], retries: number = 10){
    const texts: string[] = contents.map(_ => "")

    const blobRefs: {i: number, blob: BlobRef}[] = []
    for(let i = 0; i < contents.length; i++){
        const c = contents[i]
        if(c.content?.text != null){
            texts[i] = c.content.text
        } else if(c.content?.textBlobId){
            blobRefs.push({i, blob: {cid: c.content.textBlobId, authorId: getDidFromUri(c.uri)}})
        }
    }

    const blobTexts = await fetchTextBlobs(ctx, blobRefs.map(x => x.blob), retries)

    for(let i = 0; i < blobRefs.length; i++){
        const t = blobTexts[i]
        if(t != null){
            texts[blobRefs[i].i] = t
        } else {
            throw Error("Couldn't fetch blob for content: " + contents[blobRefs[i].i].uri)
        }
    }

    for(let i = 0; i < texts.length; i++){
        if(texts[i] != null && texts[i].length > 0 && !isPost(getCollectionFromUri(contents[i].uri)) && isCompressed(contents[i].content?.format ?? null)){
            texts[i] = decompress(texts[i])
        }
    }

    for(let i = 0; i < texts.length; i++){
        if(texts[i] == null){
            console.error(contents[i])
            throw Error(`Failed to process content ${contents[i].uri}`)
        }
    }
    return texts
}


export async function updateReferencesForNewTopics(ctx: AppContext) {
    const lastUpdate = await getLastReferencesUpdate(ctx)

    const topicsList = (await ctx.db.topic.findMany({
        select: {
            id: true
        },
        where: {
            lastEdit: {
                gt: lastUpdate
            }
        }
    })).map(t => t.id)
    if(topicsList.length == 0) {
        console.log("No new topics, skipping")
        return
    }

    console.log("Got new topics", topicsList.length)
    const contents = await ctx.db.record.findMany({
        select: {
            uri: true,
            createdAt: true,
            content: {
                select: {
                    text: true,
                    textBlobId: true,
                    format: true,
                    article: {
                        select: {
                            title: true
                        }
                    }
                }
            }
        },
        where: {
            content: {
                isNot: null
            }
        },
        orderBy: {
            createdAt: "asc"
        }
    })
    console.log("Got contents", contents.length)

    const synonymsMap = await getSynonymsToTopicsMap(ctx, topicsList)
    await updateReferencesForContentsAndTopics(ctx, contents, synonymsMap)
}


export async function updateReferences(ctx: AppContext){
    console.log("Updating references")
    const updateTime = new Date()

    const t1 = Date.now()
    console.log("Updating references for new contents...")
    await updateReferencesForNewContents(ctx)
    const t2 = Date.now()
    console.log("Done after", t2-t1)

    console.log("Updating references for new topics...")
    await updateReferencesForNewTopics(ctx)
    const t3 = Date.now()
    console.log("Done after", t3-t2)

    await setLastReferencesUpdate(ctx, updateTime)
}


async function getSynonymsToTopicsMap(ctx: AppContext, topicsList?: string[]): Promise<SynonymsMap> {
    const topics = await ctx.db.topic.findMany({
        select: {
            id: true,
            synonyms: true,
            currentVersion: {
                select: {
                    props: true
                }
            }
        },
        where: topicsList ? {
            id: {
                in: topicsList
            }
        } : undefined
    })

    const synonymsToTopicsMap: SynonymsMap = new Map()

    topics.forEach((t) => {
        const synonyms = unique(getTopicSynonyms(t).map(cleanText))

        synonyms.forEach(s => {
            if(synonymsToTopicsMap.has(s)){
                const cur = gett(synonymsToTopicsMap, s)
                cur.topics.add(t.id)
            } else {
                synonymsToTopicsMap.set(s, {topics: new Set([t.id]), regex: getSynonymRegex(s)})
            }
        })
    })

    return synonymsToTopicsMap
}