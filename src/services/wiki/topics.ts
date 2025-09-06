import {fetchTextBlobs} from "../blob";
import {getDidFromUri, getUri} from "#/utils/uri";
import {AppContext} from "#/index";
import {CAHandler, CAHandlerNoAuth, CAHandlerOutput} from "#/utils/handler";
import {TopicProp, TopicView} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {TopicViewBasic} from "#/lex-server/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicCurrentVersion, getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";
import {Agent} from "#/utils/session-agent";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms";
import {Prisma} from "@prisma/client";
import {Dataplane} from "#/services/hydration/dataplane";
import {$Typed} from "@atproto/api";
import {getTopicSynonyms, getTopicTitle} from "#/services/wiki/utils";
import {getSynonymsToTopicsMap, getTopicsReferencedInText} from "#/services/wiki/references";
import {TopicMention} from "#/lex-api/types/ar/cabildoabierto/feed/defs"
import {gett} from "#/utils/arrays";
import {getTopicHistory} from "#/services/wiki/history";
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {ArticleEmbed, ArticleEmbedView} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {isMain as isVisualizationEmbed} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {isMain as isImagesEmbed, View as ImagesEmbedView} from "#/lex-api/types/app/bsky/embed/images"
import {stringListIncludes, stringListIsEmpty} from "#/services/dataset/read"
import {logTimes} from "#/utils/utils";
import { JsonValue } from "@prisma/client/runtime/library";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {cleanText} from "#/utils/strings";

export type TimePeriod = "day" | "week" | "month" | "all"

export const getTrendingTopics: CAHandler<{params: {time: TimePeriod}}, TopicViewBasic[]> = async (ctx, agent, {params}) => {
    return await getTopics(ctx, [], "popular", params.time, 10, agent.did)
}


export type TopicQueryResultBasic = {
    id: string
    lastEdit: Date | null
    popularityScoreLastDay: number
    popularityScoreLastWeek: number
    popularityScoreLastMonth: number
    currentVersion: {
        props: Prisma.JsonValue
    } | null
    numWords: number | null
    lastRead?: Date | null
    created_at?: Date
}


export function hydrateTopicViewBasicFromUri(uri: string, data: Dataplane): {data?: $Typed<TopicViewBasic>, error?: string} {
    const q = data.topicsByUri.get(uri)
    if(!q) return {error: "No se pudo encontrar el tema."}

    return {data: topicQueryResultToTopicViewBasic(q)}
}


export function topicQueryResultToTopicViewBasic(t: TopicQueryResultBasic): $Typed<TopicViewBasic> {
    let props: TopicProp[] = []

    if(t.currentVersion && t.currentVersion.props){
        props = t.currentVersion.props as unknown as TopicProp[]
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
            "Topic.lastContentChange",
            "Content.numWords",
            eb => (
                eb
                .selectFrom("ReadSession")
                .select(
                    [eb => eb.fn.max("ReadSession.created_at").as("lastRead")
                ])
                .where("ReadSession.userId", "=", did ?? "sin did")
                .whereRef("ReadSession.readContentId", "=", "TopicVersion.uri").as("lastRead")
            )
        ])
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

    const topics = await (limit ? baseQuery.limit(limit) : baseQuery).execute()

    return {
        data: topics.map(t => topicQueryResultToTopicViewBasic({
            id: t.id,
            popularityScoreLastMonth: t.popularityScoreLastMonth,
            popularityScoreLastWeek: t.popularityScoreLastWeek,
            popularityScoreLastDay: t.popularityScoreLastDay,
            lastEdit: t.lastContentChange,
            created_at: t.created_at,
            currentVersion: {
                props: t.props as JsonValue
            },
            numWords: t.numWords,
            lastRead: getDidFromUri(t.uri) == did ? t.lastEdit : t.lastRead
        }))
    }
}


export const getTopicsHandler: CAHandler<{
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
        agent.did
    )
}


export const getCategories: CAHandler<{}, string[]> = async (ctx, _, {}) => {
    const categories = await ctx.db.topicCategory.findMany({
        select: {
            id: true
        }
    })
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


export const getCategoriesWithCounts: CAHandler<{}, { category: string, size: number }[]> = async (ctx, _, {}) => {
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


export const redisCacheEnabled = false

async function cached<T>(ctx: AppContext, key: string[], fn: () => Promise<{ data?: T, error?: string }>): Promise<{
    data?: T,
    error?: string
}> {
    if (!redisCacheEnabled) {
        return await fn()
    }
    const strKey = key.join(":")
    const cur = await ctx.ioredis.get(strKey)
    if (cur) return {data: JSON.parse(cur) as T}
    const res = await fn()
    if (res.data) {
        await ctx.ioredis.set(strKey, JSON.stringify(res), "EX", redisCacheTTL)
    }
    return res
}


export const getTopicCurrentVersionFromDB = async (ctx: AppContext, id: string): Promise<{
    data?: string | null,
    error?: string
}> => {
    const res = await ctx.db.topic.findUnique({
        select: {
            currentVersionId: true
        },
        where: {
            id
        }
    })
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
            id = await getTopicIdFromTopicVersionUri(ctx.db, did, rkey) ?? undefined
            if(!id){
                return {error: "No se encontró esta versión del tema."}
            }
        }
    }

    const {data: currentVersionId, error} = await getTopicCurrentVersionFromDB(ctx, id)
    if(error) return {error: "No se encontró el tema " + id + "."}

    let uri: string
    if (!currentVersionId) {
        console.log(`Warning: Current version not set for topic ${id}.`)
        const history = await getTopicHistory(ctx.db, id, agent.hasSession() ? agent : undefined)

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

    return await getCachedTopicVersion(ctx, uri)
}


export const getTopicHandler: CAHandlerNoAuth<{ query: { i?: string, did?: string, rkey?: string } }, TopicView> = async (ctx, agent, params) => {
    const {i, did, rkey} = params.query
    return getTopic(ctx, agent, i, did, rkey)
}


export const getCachedTopicVersion = async (ctx: AppContext, uri: string) => {
    return cached(ctx, ["topicVersion", uri], async () => getTopicVersion(ctx, uri))
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
    const topic = await ctx.db.record.findFirst({
        select: {
            uri: true,
            cid: true,
            author: {
                select: {
                    did: true,
                    handle: true,
                    displayName: true,
                    avatar: true,
                    CAProfileUri: true,
                    userValidationHash: true,
                    orgValidation: true
                }
            },
            record: true,
            createdAt: true,
            content: {
                select: {
                    text: true,
                    format: true,
                    dbFormat: true,
                    textBlob: {
                        select: {
                            cid: true,
                            authorId: true
                        }
                    },
                    topicVersion: {
                        select: {
                            topic: {
                                select: {
                                    id: true,
                                    protection: true,
                                    popularityScore: true,
                                    lastEdit: true,
                                    currentVersionId: true
                                }
                            },
                            props: true
                        }
                    }
                }
            }
        },
        where: {
            uri
        }
    })

    if (!topic || !topic.content || !topic.content.topicVersion) {
        return {error: "No se encontró la versión."}
    }

    let text: string | null = null
    let format: string | null = null
    if (topic.content.text == null) {
        if (topic.content.textBlob) {
            [text] = await fetchTextBlobs(
                ctx,
                [topic.content.textBlob]
            )
            format = topic.content.format
        }
    } else {
        text = topic.content.text
        format = topic.content.dbFormat
    }

    const author = dbUserToProfileViewBasic(topic.author)

    const id = topic.content.topicVersion.topic.id

    if (!author || !topic.cid) {
        return {error: "No se encontró el tema " + id + "."}
    }

    const {text: transformedText, format: transformedFormat} = anyEditorStateToMarkdownOrLexical(text, format)

    const props = Array.isArray(topic.content.topicVersion.props) ? topic.content.topicVersion.props as unknown as TopicProp[] : []

    const record = topic.record ? JSON.parse(topic.record) as TopicVersionRecord : undefined
    const embeds = record ? hydrateEmbedViews(author.did, record.embeds ?? []) : []

    const view: TopicView = {
        $type: "ar.cabildoabierto.wiki.topicVersion#topicView",
        id,
        uri: topic.uri,
        cid: topic.cid,
        author,
        text: transformedText,
        format: transformedFormat,
        props,
        createdAt: topic.createdAt.toISOString(),
        lastEdit: topic.content.topicVersion.topic.lastEdit?.toISOString() ?? topic.createdAt.toISOString(),
        currentVersion: topic.content.topicVersion.topic.currentVersionId ?? undefined,
        record: topic.record ? JSON.parse(topic.record) : undefined,
        embeds
    }

    return {data: view}
}


export const getTopicVersionHandler: CAHandler<{
    params: { did: string, rkey: string }
}, TopicView> = async (ctx, _, {params}) => {
    const {did, rkey} = params
    return getCachedTopicVersion(ctx, getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey))
}


export async function getTopicsTitles(ctx: AppContext, ids: string[]) {
    const res = await ctx.db.topic.findMany({
        select: {
            id: true,
            currentVersion: {
                select: {
                    props: true
                }
            }
        },
        where: {
            id: {
                in: ids
            }
        }
    })
    return new Map<string, string>(res.map(r => [r.id, getTopicTitle(r)]))
}


export const getTopicsMentioned: CAHandler<{title: string, text: string}, TopicMention[]> = async (ctx, agent, {title, text}) => {
    const t1 = Date.now()
    const m = await getSynonymsToTopicsMap(ctx)
    const t2 = Date.now()
    const refs = getTopicsReferencedInText(text + " " + title, m)
    const t3 = Date.now()
    const titles = await getTopicsTitles(ctx, refs.map(r => r.topicId))
    const t4 = Date.now()
    const data = refs
        .map(r => ({id: r.topicId, count: r.count, title: gett(titles, r.topicId)}))
        .sort((a, b) => (b.count - a.count))
    const t5 = Date.now()
    logTimes("topics mentioned", [t1, t2, t3, t4, t5])
    return {
        data
    }
}


export const getAllTopics: CAHandlerNoAuth<{}, {topicId: string, uri: string}[]> = async (ctx, _, {}) => {
    const topicVersions = await ctx.db.topicVersion.findMany({
        select: {
            topicId: true,
            uri: true,
            categories: true
        }
    })
    return {data: topicVersions}
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

    console.log("returning", Array.from(m.values()))

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
        console.log("topic", t.id, "synonyms", synonyms)
        return !synonyms.some(s => {
            return cleanText(t.id).includes(cleanText(s))
        })
    })

    return {data: data.map(d => d.id)}
}