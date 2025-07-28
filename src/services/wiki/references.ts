import {cleanText} from "#/utils/strings";
import {AppContext} from "#/index";
import {gett, unique} from "#/utils/arrays";
import {decompress} from "#/utils/compression";
import {getCollectionFromUri, getDidFromUri, isPost} from "#/utils/uri";
import {BlobRef} from "#/services/hydration/hydrate";
import {fetchTextBlobs} from "#/services/blob";
import {formatIsoDate} from "#/utils/dates";
import {getCAUsersDids} from "#/services/user/users";
import {sql} from "kysely";
import {logTimes} from "#/utils/utils";
import {v4 as uuidv4} from "uuid";
import {getTopicSynonyms} from "#/services/wiki/utils";
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {updateContentInteractionsForTopics} from "#/services/wiki/interactions";
import {updateTopicPopularities} from "#/services/wiki/popularity";

function getSynonymRegex(synonym: string){
    const escapedKey = cleanText(synonym).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(`\\b${escapedKey}\\b`, 'gi')
}


function countSynonymInText(regex: RegExp, textCleaned: string): number {
    const matches = textCleaned.match(regex);

    return matches ? matches.length : 0;
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
    console.log("Last references update", lastUpdate)

    const batchSize = 10000
    let curOffset = 0
    const synonymsMap = await getSynonymsToTopicsMap(ctx)

    const caUsers = await getCAUsersDids(ctx)

    while(true){
        const contents: ContentProps[] = await ctx.kysely
            .selectFrom('Record')
            .innerJoin('Content', 'Record.uri', 'Content.uri')
            .leftJoin('Article', 'Record.uri', 'Article.uri')
            .leftJoin('Reference', 'Reference.referencingContentId', 'Record.uri')
            .select([
                'Record.uri',
                'Record.CAIndexedAt',
                'Content.text',
                'Content.textBlobId',
                'Content.format',
                'Article.title'
            ])
            .where('Record.CAIndexedAt', '>=', lastUpdate)
            .where('Reference.id', 'is', null)
            .where("Record.authorId", "in", caUsers)
            .orderBy('Record.CAIndexedAt', 'asc')
            .limit(batchSize)
            .offset(curOffset)
            .execute()

        if(contents.length == 0) break
        curOffset += contents.length
        console.log(`Got ${contents.length} contents.`)
        await updateReferencesForContentsAndTopics(ctx, contents, synonymsMap)
    }
}


async function updateReferencesForContentsAndTopics(ctx: AppContext, contents: ContentProps[], synonymsMap: SynonymsMap, topicIds?: string[]){
    const batchSize = 500
    for(let i = 0; i < contents.length; i += batchSize){
        console.log("Updating references contents", i, "-", i+batchSize, "of", contents.length)
        try {
            const texts = await getContentsText(ctx, contents.slice(i, i+batchSize), 10)
            console.log("Apply references update")
            const referencesToInsert = getReferencesToInsert(contents, texts, synonymsMap)
            await applyReferencesUpdate(ctx, referencesToInsert, contents.slice(i, i+batchSize).map(c => c.uri), topicIds)
        } catch (err) {
            console.log("error updating references", err)
            throw err
        }
    }
}


export function getTopicsReferencedInText(text: string, synonymsMap: Map<string, {topics: Set<string>, regex: RegExp}>){
    const textCleaned = cleanText(text)
    const refs = new Map<string, number>
    Array.from(synonymsMap.values()).forEach(({topics, regex}) => {
        const count = countSynonymInText(regex, textCleaned)
        if(count > 0){
            topics.forEach(t => {
                refs.set(t, (refs.get(t) ?? 0) + count)
            })
        }
    })

    return Array.from(refs.entries()).map(([topicId, count]) => ({topicId, count}))
}

type SynonymsMap = Map<string, {topics: Set<string>, regex: RegExp}>

function withExtra(text: string, content: ContentProps){
    return text + ` ${content.title ?? ""}`
}


type ReferenceToInsert = {
    id: string
    type: "Strong" | "Weak"
    count: number
    referencedTopicId: string
    referencingContentId: string
}


function getReferencesToInsert(contents: ContentProps[], texts: (string | null)[], synonymsMap: SynonymsMap) {
    const referencesToInsert: ReferenceToInsert[] = []

    console.log("Analyzing references...")
    const t1 = Date.now()
    for(let i = 0; i < contents.length; i++){
        const c = contents[i]
        let text = texts[i]

        const references: {topicId: string, count: number}[] = getTopicsReferencedInText(withExtra(text ?? "", c), synonymsMap)
        references.forEach(r => {
            console.log(`Found reference! URI: ${c.uri}. Topic: ${r.topicId}. Count: ${r.count}`)
        })
        references.forEach(r => {
            referencesToInsert.push({
                id: uuidv4(),
                type: "Weak",
                count: r.count,
                referencingContentId: c.uri,
                referencedTopicId: r.topicId
            })
        })
    }
    const t2 = Date.now()
    console.log("Done after", t2-t1)

    return referencesToInsert
}


export async function applyReferencesUpdate(ctx: AppContext, referencesToInsert: ReferenceToInsert[], contentIds?: string[], topicIds?: string[]) {
    // asumimos que referencesToInsert tiene todas las referencias en el producto cartesiano
    // entre contentIds y topicIds
    // si contentIds es undefined son todos los contenidos y lo mismo con topicIds
    try {
        console.log("Inserting", referencesToInsert.length, "references...")
        console.log("Between", contentIds?.length, "contents and", topicIds?.length, "topics")
        const t1 = Date.now()

        if(referencesToInsert.length > 0){
            await ctx.kysely
                .insertInto("Reference")
                .values(referencesToInsert)
                .onConflict(ob => ob.columns(["referencingContentId", "referencedTopicId"]).doNothing())
                .execute()
        }

        let query = ctx.kysely
            .deleteFrom("Reference")

        if(referencesToInsert.length > 0) {
            query = query
                .where(({eb, refTuple, tuple}) =>
                    eb(
                        refTuple("Reference.referencedTopicId", 'Reference.referencingContentId'),
                        'not in',
                        referencesToInsert.map(e => tuple(e.referencedTopicId, e.referencingContentId))
                    )
                )
        }

        if(topicIds) {
            query = query
                .where("Reference.referencedTopicId", "in", topicIds)
        }

        if(contentIds) {
            query = query
                .where("Reference.referencingContentId", "in", contentIds)
        }

        await query.execute()

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
    CAIndexedAt: Date
    text: string | null
    textBlobId?: string | null
    format: string | null
    title: string | null
}


function isCompressed(format: string | null){
    if(!format) return true
    return ["lexical-compressed", "markdown-compressed"].includes(format)
}


export async function getContentsText(ctx: AppContext, contents: Omit<ContentProps, "title" | "CAIndexedAt">[], retries: number = 10, decompressed: boolean = true){
    const texts: (string | null)[] = contents.map(_ => "")

    const blobRefs: {i: number, blob: BlobRef}[] = []
    for(let i = 0; i < contents.length; i++){
        const c = contents[i]
        if(c.text != null){
            texts[i] = c.text
        } else if(c.textBlobId){
            blobRefs.push({i, blob: {cid: c.textBlobId, authorId: getDidFromUri(c.uri)}})
        }
    }

    const blobTexts = await fetchTextBlobs(ctx, blobRefs.map(x => x.blob), retries)

    for(let i = 0; i < blobRefs.length; i++){
        texts[blobRefs[i].i] = blobTexts[i]
    }

    if(decompressed){
        for(let i = 0; i < texts.length; i++){
            const text = texts[i]
            if(text != null && text.length > 0 && !isPost(getCollectionFromUri(contents[i].uri)) && isCompressed(contents[i].format ?? null)){
                try {
                    texts[i] = decompress(text)
                } catch {
                    console.log(`Error decompressing text ${contents[i].uri}`)
                    texts[i] = null
                }
            }
        }
    }

    return texts
}


async function getContentsContainingSynonyms(ctx: AppContext, synonyms: string[]){
    const cleanedSynonyms = synonyms
        .map(s => cleanText(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .filter(Boolean)

    console.log("cleaned synonyms", cleanedSynonyms)

    if (cleanedSynonyms.length === 0) return []

    const pattern = `(?<!\\w)(${cleanedSynonyms.join('|')})(?!\\w)`

    return await ctx.kysely
        .selectFrom("Content")
        .innerJoin("Record", "Record.uri", "Content.uri")
        .innerJoin("User", "User.did", "Record.authorId")
        .select([
            'Content.uri',
            sql<number>`array_length(regexp_matches("text", ${pattern}, 'gi'), 1)`.as('match_count')
        ])
        .where('text', '~*', pattern)
        .where("User.inCA", "=", true)
        .execute()
}


export async function updateReferencesForTopics(ctx: AppContext, topicIds: string[]){

    const topics = await ctx.kysely
        .selectFrom("Topic")
        .innerJoin("TopicVersion", "TopicVersion.uri", "Topic.currentVersionId")
        .select(["id", "TopicVersion.props"])
        .where("id", "in", topicIds)
        .execute()

    for(const t of topics) {
        const synonyms = getTopicSynonyms({id: t.id, props: t.props as TopicProp[]})
        console.log(`updating references for topic ${t.id} with synonyms:`, synonyms)

        const results = await getContentsContainingSynonyms(ctx, synonyms)
        const refs: ReferenceToInsert[] = []
        for(const r of results) {
            refs.push({
                id: uuidv4(),
                type: "Weak",
                count: r.match_count,
                referencedTopicId: t.id,
                referencingContentId: r.uri
            })
        }
        console.log("got refs", refs.length)
        console.log(results.slice(0, 10))
        await applyReferencesUpdate(ctx, refs, undefined, topicIds)
    }
}


export async function updateReferencesForNewTopics(ctx: AppContext) {
    const lastUpdate = await getLastReferencesUpdate(ctx)
    console.log("Last reference update", lastUpdate)

    const topicIds = (await ctx.db.topic.findMany({
        select: {
            id: true
        },
        where: {
            lastEdit: {
                gt: lastUpdate
            }
        }
    })).map(t => t.id)

    if(topicIds.length == 0) {
        console.log("No new topics, skipping")
        return
    }

    console.log("Got new topics", topicIds.length)

    await updateReferencesForTopics(ctx, topicIds)
}


export async function restartReferenceLastUpdate(ctx: AppContext) {
    await setLastReferencesUpdate(ctx, new Date(Date.now()))
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


export async function getSynonymsToTopicsMap(
    ctx: AppContext, topicsList?: string[]
): Promise<SynonymsMap> {
    const synonymsSql = sql<unknown>`
        (
            SELECT p -> 'value' -> 'value'
            FROM jsonb_array_elements(
                     -- make sure we always hand an ARRAY to jsonb_array_elements
                         COALESCE(
                                 CASE
                                     WHEN jsonb_typeof(tv.props) = 'array' THEN tv.props
                                     ELSE '[]'::jsonb
                                     END,
                                 '[]'::jsonb
                         )
                 ) AS p
            WHERE p ->> 'name' = 'Sinónimos'
                LIMIT 1
        )
    `.as('synonyms')

    const select = ctx.kysely
        .selectFrom('Topic as t')

    const t1 = Date.now()
    const topics: {synonyms: unknown, id: string}[] = await (topicsList ? select.where("t.id", "in", topicsList) : select)
        .innerJoin('TopicVersion as tv', 't.currentVersionId', 'tv.uri')
        .select(['t.id', synonymsSql])
        .execute()

    const t2 = Date.now()
    logTimes("get synonyms map 2", [t1, t2])

    const synonymsToTopicsMap: SynonymsMap = new Map()

    topics.forEach((t) => {
        const synList = t.synonyms instanceof Array ? t.synonyms as string[] : []
        const synonyms = unique(synList.map(cleanText))

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


export async function cleanNotCAReferences(ctx: AppContext) {
    const caUsers = await getCAUsersDids(ctx)
    const count = await ctx.db.reference.deleteMany({
        where: {
            referencingContent: {
                record: {
                    authorId: {
                        notIn: caUsers
                    }
                }
            }
        }
    })
    console.log(`Removed ${count.count} references.`)
}



export async function updateTopicMentions(ctx: AppContext, id: string) {
    // Actualizamos las referencias al tema y la popularidad del tema
    await updateReferencesForTopics(ctx, [id])

    await updateContentInteractionsForTopics(ctx, [id])

    await updateTopicPopularities(ctx, [id])
}