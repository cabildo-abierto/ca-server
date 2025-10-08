import {AppContext} from "#/setup.js";
import {getCAUsersDids} from "#/services/user/users.js";
import {sql} from "kysely";
import {v4 as uuidv4} from "uuid";
import {
    getEditedTopics,
    updateTopicInteractionsOnNewReactions,
    updateTopicInteractionsOnNewReferences,
    updateTopicInteractionsOnNewReplies
} from "#/services/wiki/references/interactions.js";
import {updateTopicPopularities} from "#/services/wiki/references/popularity.js";
import {updateContentsText} from "#/services/wiki/content.js";
import {getTimestamp, updateTimestamp} from "#/services/admin/status.js";
import { TopicMention } from "#/lex-api/types/ar/cabildoabierto/feed/defs.js";
import {getTopicTitle} from "#/services/wiki/utils.js";
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js"
import {getCollectionFromUri} from "#/utils/uri.js";
import {isReactionCollection} from "#/utils/type-utils.js";


export async function updateReferencesForNewContents(ctx: AppContext) {
    const lastUpdate = await getLastReferencesUpdate(ctx)
    ctx.logger.pino.info({lastUpdate}, "updating references for new contents")

    const batchSize = 500
    let curOffset = 0

    const caUsers = await getCAUsersDids(ctx)

    while (true) {
        const contents: {uri: string}[] = await ctx.kysely
            .selectFrom('Record')
            .select([
                'Record.uri',
            ])
            .innerJoin("Content", "Content.uri", "Record.uri")
            .where("Content.text", "is not", null)
            .where('Record.CAIndexedAt', '>=', lastUpdate)
            .where("Record.authorId", "in", caUsers)
            .orderBy('Record.CAIndexedAt', 'asc')
            .limit(batchSize)
            .offset(curOffset)
            .execute()

        if (contents.length == 0) break
        curOffset += contents.length
        ctx.logger.pino.info({count: contents.length, curOffset}, "updating references for new contents batch")
        const t1 = Date.now()
        await updateReferencesForContentsAndTopics(
            ctx,
            contents.map(c => c.uri),
            undefined
        )
        const t2 = Date.now()
        ctx.logger.logTimes("updating references for new contents batch", [t1, t2])
    }
}


async function ftsReferencesQuery(ctx: AppContext, uris?: string[], topics?: string[]) {
    try {
        if(uris != undefined && uris.length == 0 || topics != undefined && topics.length == 0) return []
        return await ctx.kysely
            .with(wb => wb("Synonyms").materialized(), eb => eb
                .selectFrom(
                    (eb) => eb.selectFrom("Topic")
                        .$if(topics != null, qb => qb.where("Topic.id", "in", topics!))
                        .select([
                            "Topic.id",
                            sql<string>`unnest("Topic"."synonyms")`.as("keyword")
                        ])
                        .as("UnnestedSynonyms")
                )
                .select([
                    "UnnestedSynonyms.id",
                    sql`to_tsquery('public.spanish_simple_unaccent', regexp_replace(trim("UnnestedSynonyms"."keyword"), '\\s+', ' <-> ', 'g'))`.as("query")
                ])
            )
            .selectFrom("Content")
            .innerJoin("Synonyms", (join) =>
                join.on(sql`"Content"."text_tsv" @@ "Synonyms"."query"`)
            )
            .$if(uris != null, qb => qb.where("Content.uri", "in", uris!))
            .innerJoin("Record", "Record.uri", "Content.uri")
            .innerJoin("User", "User.did", "Record.authorId")
            .where("User.inCA", "=", true)
            .where("Synonyms.query", "is not", null)
            .select([
                "Synonyms.id",
                "Content.uri",
                sql<number>`ts_rank_cd("Content"."text_tsv", "Synonyms"."query")`.as("rank")
            ])
            .execute()
    } catch (error) {
        ctx.logger.pino.error({error, topics: topics?.slice(0, 5), uris: uris?.slice(0, 5)}, "error in ftsReferences query")
        throw error
    }
}


export async function getReferencesToInsert(ctx: AppContext, uris?: string[], topics?: string[]) {
    if(!topics && !uris) throw Error("Obtener las referencias para todos los contenidos y temas es muy caro!")

    const matches = await ftsReferencesQuery(ctx, uris, topics)

    // entre cada par (tema, contenido) almacenamos a lo sumo una referencia
    const refsMap = new Map<string, ReferenceToInsert>()

    for(const m of matches) {
        const key = `${m.uri}:${m.id}`
        const cur = refsMap.get(key)
        if(!cur || !cur.relevance || cur.relevance < m.rank){
            refsMap.set(key, {
                id: uuidv4(),
                referencedTopicId: m.id,
                referencingContentId: m.uri,
                type: "Weak",
                relevance: m.rank
            })
        }
    }

    return Array.from(refsMap.values())
}


async function updateReferencesForContentsAndTopics(ctx: AppContext, contents?: string[], topics?: string[]): Promise<string[]> {
    if(!topics && !contents) throw Error("Obtener las referencias para todos los contenidos y temas es muy caro!")
    const topicBs = 10
    const contentsBs = 500
    if(!contents && topics && topics.length > topicBs) {
        const newReferences: string[] = []
        for(let i = 0; i < topics.length; i+=topicBs) {
            newReferences.push(...await updateReferencesForContentsAndTopics(ctx, contents, topics.slice(i, i+topicBs)))
        }
        return newReferences
    } else if(!topics && contents && contents.length > contentsBs) {
        const newReferences: string[] = []
        for(let i = 0; i < contents.length; i+=contentsBs) {
            newReferences.push(...await updateReferencesForContentsAndTopics(ctx, contents.slice(i, i+contentsBs), topics))
        }
        return newReferences
    } else {
        const referencesToInsert = await getReferencesToInsert(ctx, contents, topics)
        await applyReferencesUpdate(
            ctx,
            referencesToInsert,
            contents,
            topics
        )
        return referencesToInsert.map(r => r.id)
    }
}


export type ReferenceToInsert = {
    id: string
    type: "Strong" | "Weak"
    count?: number
    relevance?: number
    referencedTopicId: string
    referencingContentId: string
}


async function applyReferencesUpdate(ctx: AppContext, referencesToInsert: ReferenceToInsert[], contentUris?: string[], topicIds?: string[]) {
    // asumimos que referencesToInsert tiene todas las referencias en el producto cartesiano
    // entre contentIds y topicIds
    // si contentIds es undefined son todos los contenidos y lo mismo con topicIds
    if(contentUris != null && contentUris.length == 0 || topicIds != null && topicIds.length == 0) return

    try {
        const date = new Date()
        ctx.logger.pino.info({count: referencesToInsert.length}, "applying references update")

        if(referencesToInsert.length > 0){
            await ctx.kysely
                .insertInto("Reference")
                .values(referencesToInsert
                    .map(r => ({...r, touched_tz: date})))
                .onConflict(oc => oc.columns(["referencingContentId", "referencedTopicId"]).doUpdateSet(eb => ({
                    touched: eb.ref("excluded.touched_tz"),
                    relevance: eb.ref("excluded.relevance")
                })))
                .execute()
        }

        await ctx.kysely
            .deleteFrom("Reference")
            .where("touched", "<", date)
            .$if(
                contentUris != null,
                qb => qb.where("Reference.referencingContentId", "in", contentUris!))
            .$if(
                topicIds != null,
                qb => qb.where("Reference.referencedTopicId", "in", topicIds!))
            .execute()
    } catch (e) {
        ctx.logger.pino.error({error: e}, "error applying references update")
        throw e
    }
}

export type TextAndFormat = { text: string, format: string | null }

export async function getLastReferencesUpdate(ctx: AppContext) {
    return (await getTimestamp(ctx, "last-references-update")) ?? new Date(0)
}


export async function setLastReferencesUpdate(ctx: AppContext, date: Date) {
    ctx.logger.pino.info({date}, "setting last references update")
    await updateTimestamp(ctx, "last-references-update", date)
}


export async function updateReferencesForNewTopics(ctx: AppContext) {
    const lastUpdate = await getLastReferencesUpdate(ctx)

    ctx.logger.pino.info({lastUpdate}, "updating references for new topics")
    const topicIds = await getEditedTopics(ctx, lastUpdate)

    ctx.logger.pino.info({count: topicIds.length, head: topicIds.slice(0, 5)}, "edited topics")

    if (topicIds.length == 0) {
        return
    }

    const bs = 10
    for(let i = 0; i < topicIds.length; i+=bs) {
        ctx.logger.pino.info({newTopics: topicIds.length, bs}, "updating references for new topics batch")
        const t1 = Date.now()
        await updateReferencesForContentsAndTopics(ctx, undefined, topicIds.slice(i, i+bs))
        const t2 = Date.now()
        ctx.logger.logTimes("updating references for new topics batch", [t1, t2])
    }
}


export async function updateReferences(ctx: AppContext) {
    const updateTime = new Date()

    await updateReferencesForNewContents(ctx)
    await updateReferencesForNewTopics(ctx)

    await setLastReferencesUpdate(ctx, updateTime)
}


export async function cleanNotCAReferences(ctx: AppContext) {
    const caUsers = await getCAUsersDids(ctx)

    await ctx.kysely
        .deleteFrom("Reference")
        .innerJoin("Record", "Reference.referencingContentId", "Record.uri")
        .where("Record.authorId", "not in", caUsers)
        .execute()
}


export async function updatePopularitiesOnTopicsChange(ctx: AppContext, topicIds: string[]) {
    const t1 = Date.now()
    await updateContentsText(ctx)
    const t2 = Date.now()
    const newReferences = await updateReferencesForContentsAndTopics(ctx, undefined, topicIds)
    const t3 = Date.now()
    await updateTopicInteractionsOnNewReferences(ctx, newReferences)
    const t4 = Date.now()
    await updateTopicPopularities(ctx, topicIds)
    const t5 = Date.now()

    ctx.logger.logTimes(`update refs and pops on ${topicIds.length} topics`, [t1, t2, t3, t4, t5])
}


export async function updatePopularitiesOnContentsChange(ctx: AppContext, uris: string[]) {
    const t1 = Date.now()
    await updateContentsText(ctx, uris)
    const t2 = Date.now()
    const newReferences = await updateReferencesForContentsAndTopics(ctx, uris, undefined)
    const t3 = Date.now()
    const topicsWithNewInteractions = await updateTopicInteractionsOnNewReferences(ctx, newReferences)
    const t4 = Date.now()
    topicsWithNewInteractions.push(...await updateTopicInteractionsOnNewReplies(ctx, uris))
    const t5 = Date.now()

    await updateTopicPopularities(ctx, topicsWithNewInteractions)
    const t6 = Date.now()

    ctx.logger.logTimes(`update refs and pops on ${uris.length} contents`, [t1, t2, t3, t4, t5, t6])
}


export async function updatePopularitiesOnNewReactions(ctx: AppContext, uris: string[]) {
    uris = uris.filter(r => isReactionCollection(getCollectionFromUri(r)))
    if(uris.length == 0) return

    const t1 = Date.now()
    const topicsWithNewInteractions = await updateTopicInteractionsOnNewReactions(ctx, uris)
    const t2 = Date.now()

    await updateTopicPopularities(ctx, topicsWithNewInteractions)
    const t3 = Date.now()

    ctx.logger.logTimes("update-popularities-on-new-reactions", [t1, t2, t3])
}


export async function recreateAllReferences(ctx: AppContext, since: Date = new Date(0)) {
    const current = await getLastReferencesUpdate(ctx)
    ctx.logger.pino.info({current}, "last references update was")
    await updateContentsText(ctx)
    await setLastReferencesUpdate(ctx, since)
    const startDate = new Date()
    await updateReferencesForNewContents(ctx)
    await setLastReferencesUpdate(ctx, startDate)
}


export async function recomputeTopicInteractionsAndPopularities(ctx: AppContext, since: Date = new Date(0)) {
    let offset = 0
    const bs = 2000

    while(true){
        const t1 = Date.now()
        const references = await ctx.kysely
            .selectFrom("Reference")
            .innerJoin("Record", "Record.uri", "Reference.referencingContentId")
            .select(["id", "referencedTopicId"])
            .limit(bs)
            .offset(offset)
            .where("Record.created_at", ">", since)
            .execute()
        const t2 = Date.now()
        if(references.length == 0) break

        await updateTopicInteractionsOnNewReferences(ctx, references.map(r => r.id))
        const t3 = Date.now()
        const topics = references.map(r => r.referencedTopicId)
        await updateTopicPopularities(ctx, topics)
        const t4 = Date.now()

        ctx.logger.logTimes("recomputing topic interactions and popularities batch", [t1, t2, t3, t4], {offset})
        offset += bs
        if(references.length < bs) break
    }
}


export async function getTopicsReferencedInText(ctx: AppContext, text: string): Promise<TopicMention[]> {
    if (!text.trim()) return []

    const text_tsv = sql`to_tsvector('public.spanish_unaccent', ${text})`;

    const matches = await ctx.kysely
        .with("Synonyms", eb => eb
            .selectFrom("Topic")
            .select(["id", "currentVersionId", sql<string>`unnest("Topic"."synonyms")`.as("keyword")])
        )
        .selectFrom("Synonyms")
        .where(sql<boolean>`${text_tsv} @@ to_tsquery('public.spanish_simple_unaccent', regexp_replace(trim("Synonyms"."keyword"), '\\s+', ' <-> ', 'g'))`)
        .innerJoin("TopicVersion", "TopicVersion.uri", "Synonyms.currentVersionId")
        .select([
            'Synonyms.id as topicId',
            'Synonyms.keyword',
            "TopicVersion.props",
            sql<number>`ts_rank_cd(${text_tsv}, to_tsquery('public.spanish_simple_unaccent', regexp_replace(trim("Synonyms"."keyword"), '\\s+', ' <-> ', 'g')))`.as('rank')
        ])
        .execute();

    const topicsMap = new Map<string, TopicMention>()
    for (const match of matches) {
        const existing = topicsMap.get(match.topicId)

        if (!existing || match.rank > existing.count) {
            topicsMap.set(match.topicId, {
                id: match.topicId,
                count: match.rank,
                title: getTopicTitle({id: match.topicId, props: match.props as TopicProp[]}),
            })
        }
    }

    return Array.from(topicsMap.values())
        .sort((a, b) => b.count - a.count)
}