import {fetchTextBlobs} from "../blob";
import {getDidFromUri, getUri} from "#/utils/uri";
import {AppContext} from "#/setup";
import {CAHandlerNoAuth, CAHandlerOutput} from "#/utils/handler";
import {TopicProp, TopicView} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {TopicViewBasic} from "#/lex-server/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicCurrentVersion, getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";
import {Agent} from "#/utils/session-agent";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms";
import {Dataplane} from "#/services/hydration/dataplane";
import {$Typed} from "@atproto/api";
import {getTopicSynonyms} from "#/services/wiki/utils";
import {TopicMention} from "#/lex-api/types/ar/cabildoabierto/feed/defs"
import {getTopicHistory} from "#/services/wiki/history";
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {ArticleEmbed, ArticleEmbedView} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {isMain as isVisualizationEmbed} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {isMain as isImagesEmbed, View as ImagesEmbedView} from "#/lex-api/types/app/bsky/embed/images"
import {stringListIncludes, stringListIsEmpty} from "#/services/dataset/read"
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {cleanText} from "#/utils/strings";
import {getTopicsReferencedInText} from "#/services/wiki/references/references";

export type TimePeriod = "day" | "week" | "month" | "all"

export const getTrendingTopics: CAHandlerNoAuth<{params: {time: TimePeriod}}, TopicViewBasic[]> = async (ctx, agent, {params}) => {
    return await getTopics(ctx, [], "popular", params.time, 10, agent.hasSession() ? agent.did : undefined)
}


export type TopicQueryResultBasic = {
    id: string
    lastEdit: Date | null
    popularityScoreLastDay: number
    popularityScoreLastWeek: number
    popularityScoreLastMonth: number
    props: unknown
    numWords: number | null
    lastRead?: Date | null
    created_at?: Date
}


export type TopicVersionQueryResultBasic = TopicQueryResultBasic & {uri: string}


export function hydrateTopicViewBasicFromUri(uri: string, data: Dataplane): {data?: $Typed<TopicViewBasic>, error?: string} {
    const q = data.topicsByUri.get(uri)
    if(!q) return {error: "No se pudo encontrar el tema."}

    return {data: topicQueryResultToTopicViewBasic(q)}
}


export function topicQueryResultToTopicViewBasic(t: TopicQueryResultBasic): $Typed<TopicViewBasic> {
    let props: TopicProp[] = []

    if(t.props){
        props = t.props as TopicProp[]
    } else {
        props.push({
            name: "Título",
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringProp",
                value: t.id
            }
        })
    }

    return {
        $type: "ar.cabildoabierto.wiki.topicVersion#topicViewBasic",
        id: t.id,
        lastEdit: t.lastEdit?.toISOString() ?? undefined,
        popularity: {
            lastDay: [t.popularityScoreLastDay],
            lastWeek: [t.popularityScoreLastWeek],
            lastMonth: [t.popularityScoreLastMonth]
        },
        props,
        numWords: t.numWords != null ? t.numWords : undefined,
        lastSeen: t.lastRead?.toISOString(),
        currentVersionCreatedAt: t.created_at?.toISOString()
    }
}


export async function getTopics(
    ctx: AppContext,
    categories: string[],
    sortedBy: "popular" | "recent",
    time: TimePeriod,
    limit?: number,
    did?: string
): CAHandlerOutput<TopicViewBasic[]> {

    let baseQuery = ctx.kysely
        .selectFrom('Topic')
        .innerJoin('TopicVersion', 'TopicVersion.uri', 'Topic.currentVersionId')
        .innerJoin("Record", "TopicVersion.uri", "Record.uri")
        .innerJoin("Content", "Content.uri", "TopicVersion.uri")
        .innerJoin("User", "User.did", "Record.authorId")
        .select([
            "id",
            "lastEdit",
            "Topic.popularityScoreLastDay",
            "Topic.popularityScoreLastWeek",
            "Topic.popularityScoreLastMonth",
            "TopicVersion.props",
            "TopicVersion.uri",
            "Record.created_at",
            "TopicVersion.charsAdded",
            "TopicVersion.charsDeleted",
            "Content.numWords",
            eb => (
                eb
                .selectFrom("ReadSession")
                .select(
                    [eb => eb.fn.max("ReadSession.created_at").as("lastRead")
                ])
                .where("ReadSession.userId", "=", did ?? "no did")
                .whereRef("ReadSession.readContentId", "=", "TopicVersion.uri").as("lastRead")
            )
        ])
        .where("Record.record", "is not", null)
        .where("Record.cid", "is not", null)
        .where("User.inCA", "=", true)
        .where(categories.includes("Sin categoría") ?
            stringListIsEmpty("Categorías") :
            (eb) =>
                eb.and(categories.map(c => stringListIncludes("Categorías", c))
                )
        )
        .where("Topic.lastEdit", "is not", null)

    if(sortedBy === "popular"){
        if(time == "all" || time == "month"){
            baseQuery = baseQuery
                .orderBy("popularityScoreLastMonth desc")
                .orderBy("lastEdit desc")
        } else if(time == "week"){
            baseQuery = baseQuery
                .orderBy("popularityScoreLastWeek desc")
                .orderBy("lastEdit desc")
        } else if(time == "day"){
            baseQuery = baseQuery
                .orderBy("popularityScoreLastDay desc")
                .orderBy("lastEdit desc")
        }
    } else if(sortedBy == "recent"){
        baseQuery = baseQuery.orderBy("lastEdit desc")
    }
    const t1 = Date.now()
    const topics = await (limit ? baseQuery.limit(limit) : baseQuery).execute()
    const t2 = Date.now()
    ctx.logger.logTimes("get trending topics", [t1, t2])
    return {
        data: topics.map(t => topicQueryResultToTopicViewBasic({
            id: t.id,
            popularityScoreLastMonth: t.popularityScoreLastMonth,
            popularityScoreLastWeek: t.popularityScoreLastWeek,
            popularityScoreLastDay: t.popularityScoreLastDay,
            lastEdit: t.lastEdit,
            created_at: t.created_at,
            props: t.props,
            numWords: t.numWords,
            lastRead: getDidFromUri(t.uri) == did ? t.lastEdit : t.lastRead
        }))
    }
}


export const getTopicsHandler: CAHandlerNoAuth<{
    params: { sort: string, time: string },
    query: { c: string[] | string }
}, TopicViewBasic[]> = async (ctx, agent, {params, query}) => {
    let {sort, time} = params
    const {c} = query
    const categories = Array.isArray(c) ? c : c ? [c] : []

    if (sort != "popular" && sort != "recent") return {error: `Criterio de ordenamiento inválido: ${sort}`}
    if (time != "day" && time != "week" && time != "month" && time != "all") {
        console.log(`Período de tiempo inválido: ${time}`)
        return {error: `Período de tiempo inválido: ${time}`}
    }

    return await getTopics(
        ctx,
        categories,
        sort,
        time as TimePeriod,
        50,
        agent.hasSession() ? agent.did : undefined
    )
}


export const getCategories: CAHandlerNoAuth<{}, string[]> = async (ctx, _, {}) => {
    const categories = await ctx.kysely
        .selectFrom("TopicCategory")
        .select("id")
        .execute()
    categories.push({id: "Sin categoría"})
    return {data: categories.map(c => c.id)}
}


async function countTopicsNoCategories(ctx: AppContext) {

    return ctx.kysely
        .selectFrom("Topic")
        .leftJoin("TopicToCategory", "Topic.id", "TopicToCategory.topicId")
        .select(({ fn }) => [fn.count<number>("Topic.id").as("count")])
        .where("TopicToCategory.categoryId", "is", null)
        .where("Topic.currentVersionId", "is not", null)
        .where("Topic.lastEdit", "is not", null)
        .execute()
}


async function countTopicsInEachCategory(ctx: AppContext) {
    return ctx.kysely
        .selectFrom("TopicToCategory")
        .innerJoin("Topic", "TopicToCategory.topicId", "Topic.id")
        .select(({ fn }) => [
            "TopicToCategory.categoryId",
            fn.count<number>("TopicToCategory.topicId").as("count")
        ])
        .where("Topic.currentVersionId", "is not", null)
        .where("Topic.lastEdit", "is not", null)
        .groupBy("TopicToCategory.categoryId")
        .execute()
}


export const getCategoriesWithCounts: CAHandlerNoAuth<{}, { category: string, size: number }[]> = async (ctx, _, {}) => {
    let [categories, noCategoryCount] = await Promise.all([
        countTopicsInEachCategory(ctx),
        countTopicsNoCategories(ctx)
    ])

    categories = categories.filter(c => (c.count > 0))

    const res = categories.map(({categoryId, count}) => ({category: categoryId, size: count}))
    res.push({category: "Sin categoría", size: noCategoryCount[0].count})
    return {data: res}
}


export const redisCacheTTL = 60*60*24*30


export function dbUserToProfileViewBasic(author: {
    did: string,
    handle: string | null,
    displayName: string | null,
    avatar: string | null
    CAProfileUri: string | null,
    userValidationHash: string | null,
    orgValidation: string | null
} | null): CAProfileViewBasic | null {
    if (!author || !author.handle) return null
    return {
        $type: "ar.cabildoabierto.actor.defs#profileViewBasic",
        did: author.did,
        handle: author.handle,
        displayName: author.displayName ?? undefined,
        avatar: author.avatar ?? undefined,
        caProfile: author.CAProfileUri ?? undefined,
        verification: author.orgValidation ? "org" : (author.userValidationHash ? "person" : undefined)
    }
}


export const getTopicCurrentVersionFromDB = async (ctx: AppContext, id: string): Promise<{
    data?: string | null,
    error?: string
}> => {
    const res = await ctx.kysely
        .selectFrom("Topic")
        .select("currentVersionId")
        .where("id", "=", id)
        .executeTakeFirst()

    if (res) {
        return {data: res.currentVersionId}
    } else {
        return {error: `No se encontró el tema: ${id}`}
    }
}


export const getTopic = async (ctx: AppContext, agent: Agent, id?: string, did?: string, rkey?: string): Promise<{
    data?: TopicView,
    error?: string
}> => {
    if(!id){
        if(!did || !rkey){
            return {error: "Se requiere un id o un par did y rkey."}
        } else {
            id = await getTopicIdFromTopicVersionUri(ctx, did, rkey) ?? undefined
            if(!id){
                return {error: "No se encontró esta versión del tema."}
            }
        }
    }

    const {data: currentVersionId, error} = await getTopicCurrentVersionFromDB(ctx, id)
    if(error) return {error: "No se encontró el tema " + id + "."}

    let uri: string
    if (!currentVersionId) {
        ctx.logger.pino.warn({id}, `Warning: Current version not set for topic.`)
        const history = await getTopicHistory(ctx, id, agent.hasSession() ? agent : undefined)

        if (!history) {
            return {error: "No se encontró el tema " + id + "."}
        }

        const index = getTopicCurrentVersion(history.protection, history.versions)
        if (index == null) {
            return {error: "No se encontró el tema " + id + "."}
        }
        uri = history.versions[index].uri
    } else {
        uri = currentVersionId
    }

    return await getTopicVersion(ctx, uri)
}


export const getTopicHandler: CAHandlerNoAuth<{ query: { i?: string, did?: string, rkey?: string } }, TopicView> = async (ctx, agent, params) => {
    const {i, did, rkey} = params.query
    return getTopic(ctx, agent, i, did, rkey)
}


export function hydrateEmbedViews(authorId: string, embeds: ArticleEmbed[]): ArticleEmbedView[] {
    const views: ArticleEmbedView[] = []
    for(let i = 0; i < embeds.length; i++) {
        const e = embeds[i]
        if(isVisualizationEmbed(e.value)){
            views.push({
                $type: "ar.cabildoabierto.feed.article#articleEmbedView",
                value: {
                    ...e.value,
                    $type: "ar.cabildoabierto.embed.visualization"
                },
                index: e.index
            })
        } else if(isImagesEmbed(e.value)) {
            const embed = e.value
            const imagesView: $Typed<ImagesEmbedView> = {
                $type: "app.bsky.embed.images#view",
                images: embed.images.map(i => {
                    return {
                        $type: "app.bsky.embed.images#viewImage",
                        alt: i.alt,
                        thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${authorId}/${i.image.ref.$link}`,
                        fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/${authorId}/${i.image.ref.$link}`
                    }
                })
            }
            views.push({
                $type: "ar.cabildoabierto.feed.article#articleEmbedView",
                value: imagesView,
                index: e.index
            })
        }
    }
    return views
}


export const getTopicVersion = async (ctx: AppContext, uri: string): Promise<{
    data?: TopicView,
    error?: string
}> => {
    const authorId = getDidFromUri(uri)

    const topic = await ctx.kysely
        .selectFrom("TopicVersion")
        .innerJoin("Record", "TopicVersion.uri", "Record.uri")
        .innerJoin("Content", "TopicVersion.uri", "Content.uri")
        .innerJoin("Topic", "Topic.id", "TopicVersion.topicId")
        .select([
            "Record.uri",
            "Record.cid",
            "Record.created_at",
            "Record.record",
            "TopicVersion.props",
            "Content.text",
            "Content.format",
            "Content.dbFormat",
            "Content.textBlobId",
            "Topic.id",
            "Topic.protection",
            "Topic.popularityScore",
            "Topic.lastEdit",
            "Topic.currentVersionId"
        ])
        .where("TopicVersion.uri", "=", uri)
        .where("Record.record", "is not", null)
        .where("Record.cid", "is not", null)
        .executeTakeFirst()

    if (!topic || !topic.cid) {
        ctx.logger.pino.info({uri, topic}, "topic version not found")
        return {error: "No se encontró la versión."}
    }

    let text: string | null = null
    let format: string | null = null
    if (topic.text == null) {
        if (topic.textBlobId) {
            [text] = await fetchTextBlobs(
                ctx,
                [{cid: topic.textBlobId, authorId: authorId}]
            )
            format = topic.format
        }
    } else {
        text = topic.text
        format = topic.dbFormat
    }

    const id = topic.id

    const {text: transformedText, format: transformedFormat} = anyEditorStateToMarkdownOrLexical(text, format)

    const props = Array.isArray(topic.props) ? topic.props as TopicProp[] : []

    const record = topic.record ? JSON.parse(topic.record) as TopicVersionRecord : undefined
    const embeds = record ? hydrateEmbedViews(authorId, record.embeds ?? []) : []

    const view: TopicView = {
        $type: "ar.cabildoabierto.wiki.topicVersion#topicView",
        id,
        uri: topic.uri,
        cid: topic.cid,
        text: transformedText,
        format: transformedFormat,
        props,
        createdAt: topic.created_at.toISOString(),
        lastEdit: topic.lastEdit?.toISOString() ?? topic.created_at.toISOString(),
        currentVersion: topic.currentVersionId ?? undefined,
        record: topic.record ? JSON.parse(topic.record) : undefined,
        embeds
    }

    return {data: view}
}


export const getTopicVersionHandler: CAHandlerNoAuth<{
    params: { did: string, rkey: string }
}, TopicView> = async (ctx, _, {params}) => {
    const {did, rkey} = params
    return getTopicVersion(ctx, getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey))
}


// TO DO: Usar el título cuando hagamos que las referencias también lo usen
export const getTopicsMentioned: CAHandlerNoAuth<{title: string, text: string}, TopicMention[]> = async (ctx, agent, {title, text}) => {
    const t1 = Date.now()
    const topicMentions = await getTopicsReferencedInText(ctx, text)
    const t2 = Date.now()
    ctx.logger.logTimes("topics mentioned", [t1, t2])
    return {
        data: topicMentions
    }
}


export const getAllTopics: CAHandlerNoAuth<{}, {topicId: string, uri: string}[]> = async (ctx, _, {}) => {
    return {error: "sin implementar"}
}


type TopicWithEditors = {
    topicId: string
    editors: string[]
}

export const getTopicsInCategoryForBatchEditing: CAHandlerNoAuth<{params: {cat: string}}, TopicWithEditors[]> = async (ctx, agent, {params}) => {
    const {data: topics, error} = await getTopics(
        ctx,
        [params.cat],
        "recent",
        "all",
        undefined,
        agent.hasSession() ? agent.did : undefined
    )

    if(!topics) {
        console.log("error getting topics", error)
        return {error}
    }

    const editors = await ctx.kysely
        .selectFrom("TopicVersion")
        .innerJoin("Record", "Record.uri", "TopicVersion.uri")
        .innerJoin("User", "User.did", "Record.authorId")
        .select(["topicId", "User.handle", "User.did"])
        .where("TopicVersion.topicId", "in", topics.map(t => t.id))
        .execute()

    const m = new Map<string, TopicWithEditors>()

    editors.forEach(editor => {
        if(!editor.handle) return
        let cur = m.get(editor.topicId)
        if(!cur) {
            m.set(editor.topicId, {
                topicId: editor.topicId,
                editors: [editor.handle]
            })
        } else {
            m.set(editor.topicId, {
                topicId: editor.topicId,
                editors: [...cur.editors, editor.handle]
            })
        }
    })

    return {data: Array.from(m.values())}
}


export const getTopicsWhereTitleIsNotSetAsSynonym: CAHandlerNoAuth<{}, string[]> = async (ctx, agent, {}) => {
    const topics = await ctx.kysely.selectFrom("Topic")
        .where("Topic.id", "not like", "%Ley%")
        .innerJoin("TopicVersion", "TopicVersion.uri", "Topic.currentVersionId")
        .select(["TopicVersion.props", "Topic.id"])
        .execute()

    const data = topics.filter(t => {
        const synonyms = getTopicSynonyms({
            id: t.id,
            props: t.props as TopicProp[]
        })
        return !synonyms.some(s => {
            return cleanText(t.id).includes(cleanText(s))
        })
    })

    return {data: data.map(d => d.id)}
}