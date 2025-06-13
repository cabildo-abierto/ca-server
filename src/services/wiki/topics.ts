import {fetchTextBlobs} from "../blob";
import {getUri, splitUri} from "#/utils/uri";
import {AppContext} from "#/index";
import {CAHandler, CAHandlerNoAuth, CAHandlerOutput} from "#/utils/handler";
import {TopicProp, TopicView} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {TopicViewBasic} from "#/lex-server/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicCurrentVersion, getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";
import {SessionAgent} from "#/utils/session-agent";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms";
import {Prisma} from "@prisma/client";
import {Dataplane} from "#/services/hydration/dataplane";
import {$Typed} from "@atproto/api";
import {getTopicTitle} from "#/services/wiki/utils";
import {getSynonymsToTopicsMap, getTopicsReferencedInText} from "#/services/wiki/references";
import {TopicMention} from "#/lex-api/types/ar/cabildoabierto/feed/defs"
import {gett} from "#/utils/arrays";
import {getTopicHistoryHandler} from "#/services/wiki/history";
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {ArticleEmbed, ArticleEmbedView} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {isMain as isVisualizationEmbed} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {isMain as isImagesEmbed, View as ImagesEmbedView} from "#/lex-api/types/app/bsky/embed/images"

export const getTopTrendingTopics: CAHandler<{}, TopicViewBasic[]> = async (ctx, agent) => {
    return await getTopics(ctx, agent, [], "popular", 10)
}

type TopicOrder = "popular" | "recent"


export async function getTopicsSkeleton(ctx: AppContext, categories: string[], orderBy: TopicOrder, limit: number) {
    const jsonbArray = JSON.stringify(categories)
    let orderByClause
    if (orderBy === 'popular') {
        orderByClause = `t."popularityScore" DESC`
    } else {
        orderByClause = `t."lastEdit" DESC`
    }

    let topics: {id: string}[]
    if(categories.includes("Sin categoría")){
        // Idea: get all topics where Categorías isn't present or has length 0

        topics = await ctx.db.$queryRawUnsafe(`
            SELECT t.id
            FROM "Topic" t
                     JOIN "TopicVersion" v ON t."currentVersionId" = v."uri"
            WHERE t."popularityScore" IS NOT NULL
              AND t."lastEdit" IS NOT NULL
              AND (
                v."props" IS NULL
                    OR (
                    jsonb_typeof(v."props") = 'array'
                        AND (
                        NOT EXISTS (
                            SELECT 1
                            FROM jsonb_array_elements(v."props") AS prop
                            WHERE prop ->> 'name' = 'Categorías'
                        )
                            OR EXISTS (
                            SELECT 1
                            FROM jsonb_array_elements(v."props") AS prop
                            WHERE prop ->> 'name' = 'Categorías'
                              AND (
                                  prop -> 'value' -> 'value' IS NULL
                                  OR jsonb_array_length(prop -> 'value' -> 'value') = 0
                              )
                        )
                        )
                    )
                )
            ORDER BY ${orderByClause}
                LIMIT $2
        `, jsonbArray, limit);
    } else {
        topics = await ctx.db.$queryRawUnsafe(`
        SELECT t.id
        FROM "Topic" t
                 JOIN "TopicVersion" v ON t."currentVersionId" = v."uri"
        WHERE t."popularityScore" IS NOT NULL
          AND t."lastEdit" IS NOT NULL
          AND (
            (
                v."props" IS NOT NULL
                    AND jsonb_typeof(v."props") = 'array'
                    AND EXISTS (SELECT 1
                                FROM jsonb_array_elements(v."props") AS prop
                                WHERE (prop ->>'name' = 'Categorías'
                    AND (prop->'value'->'value')::jsonb @> $1::jsonb))
                )
                OR
            (
                ${categories.length === 0 ? 'TRUE' : 'FALSE'}
            )
        )
        ORDER BY ${orderByClause} LIMIT $2
    `, jsonbArray, limit)
    }

    return topics as {id: string}[]
}


export type TopicQueryResultBasic = {
    id: string
    lastEdit: Date | null
    popularityScore: number | null
    categories: {categoryId: string}[]
    synonyms: string[]
    currentVersion: {
        props: Prisma.JsonValue
        categories: string | null
        synonyms: string | null
    } | null
}


export function hydrateTopicViewBasicFromUri(uri: string, data: Dataplane): {data?: $Typed<TopicViewBasic>, error?: string} {
    const q = data.topicsByUri.get(uri)
    if(!q) return {error: "No se pudo encontrar el tema."}

    return {data: topicQueryResultToTopicViewBasic(q)}
}


export function hydrateTopicViewBasicFromTopicId(id: string, data: Dataplane) {
    const q = data.topicsById.get(id)
    if(!q) return null

    return topicQueryResultToTopicViewBasic(q)
}


export function topicQueryResultToTopicViewBasic(t: TopicQueryResultBasic): $Typed<TopicViewBasic> {
    let props: TopicProp[] = []

    if(t.currentVersion && t.currentVersion.props){
        props = t.currentVersion.props as unknown as TopicProp[]
    } else {
        if(t.categories.length > 0) props.push({
            name: "Categorías",
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringListProp",
                value: t.categories.map(c => c.categoryId)
            }
        }); else if(t.currentVersion && t.currentVersion.categories) props.push({
            name: "Categorías",
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringListProp",
                value: JSON.parse(t.currentVersion.categories)
            }
        })

        props.push({
            name: "Título",
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringProp",
                value: t.id
            }
        })

        if(t.categories.length > 0) props.push({
            name: "Sinónimos",
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringListProp",
                value: t.synonyms
            }
        }); else if(t.currentVersion && t.currentVersion.synonyms) props.push({
            name: "Sinónimos",
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringListProp",
                value: JSON.parse(t.currentVersion.synonyms)
            }
        })
    }

    return {
        $type: "ar.cabildoabierto.wiki.topicVersion#topicViewBasic",
        id: t.id,
        lastEdit: t.lastEdit?.toISOString() ?? undefined,
        popularity: t.popularityScore != null ? [t.popularityScore] : undefined,
        props
    }
}


export async function getTopics(
    ctx: AppContext,
    agent: SessionAgent,
    categories: string[],
    sortedBy: "popular" | "recent",
    limit: number): CAHandlerOutput<TopicViewBasic[]> {

    const skeleton = await getTopicsSkeleton(ctx, categories, sortedBy, limit)

    const data = new Dataplane(ctx, agent)
    await data.fetchTopicsBasicByIds(skeleton.map(s => s.id))

    return {data: skeleton.map(s => hydrateTopicViewBasicFromTopicId(s.id, data)).filter(x => x != null)}
}


export const getTopicsHandler: CAHandler<{
    params: { sort: string },
    query: { c: string[] | string }
}, TopicViewBasic[]> = async (ctx, agent, {params, query}) => {
    const {sort} = params
    const {c} = query
    const categories = Array.isArray(c) ? c : c ? [c] : []

    if (sort != "popular" && sort != "recent") return {error: `Criterio de ordenamiento inválido: ${sort}`}

    return await getTopics(ctx, agent, categories, sort, 50)
}


export const getCategories: CAHandler<{}, { category: string, size: number }[]> = async (ctx, agent, {}) => {

    const categoriesP = ctx.db.topicCategory.findMany({
        select: {
            id: true,
            _count: {
                select: {
                    topics: true
                }
            }
        }
    })

    const noCategoryCountP = ctx.db.topic.count({
        where: {
            categories: {
                none: {}
            }
        }
    })

    let [categories, noCategoryCount] = await Promise.all([categoriesP, noCategoryCountP])

    categories = categories.filter(c => (c._count.topics > 0))

    const res = categories.map(({id, _count}) => ({category: id, size: _count.topics}))
    res.push({category: "Sin categoría", size: noCategoryCount})
    return {data: res}
}


export const redisCacheTTL = 60*60*24*30


export function dbUserToProfileViewBasic(author: {
    did: string,
    handle: string | null,
    displayName: string | null,
    avatar: string | null
} | null) {
    if (!author || !author.handle) return null
    return {
        did: author.did,
        handle: author.handle,
        displayName: author.displayName ?? undefined,
        avatar: author.avatar ?? undefined,
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


export const getTopicCurrentVersionFromDB = async (ctx: AppContext, agent: SessionAgent, id: string): Promise<{
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


export const getTopic = async (ctx: AppContext, agent: SessionAgent, id?: string, did?: string, rkey?: string): Promise<{
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

    const {data: currentVersionId} = await cached(ctx, ["currentVersion", id], async () => getTopicCurrentVersionFromDB(ctx, agent, id))
    let uri: string
    if (!currentVersionId) {
        console.log(`Warning: Current version not set for topic ${id}.`)
        const {data: history} = await getTopicHistoryHandler(ctx, agent, {params: {id}})

        if (!history) {
            return {error: "No se encontró el tema " + id + "."}
        }

        const index = getTopicCurrentVersion(history.versions)
        if (index == null) {
            return {error: "No se encontró el tema " + id + "."}
        }
        uri = history.versions[index].uri
    } else {
        uri = currentVersionId
    }

    return await getCachedTopicVersion(ctx, agent, uri)
}


export const getTopicHandler: CAHandler<{ query: { i?: string, did?: string, rkey?: string } }, TopicView> = async (ctx, agent, params) => {
    const {i, did, rkey} = params.query
    return getTopic(ctx, agent, i, did, rkey)
}


export const getCachedTopicVersion = async (ctx: AppContext, agent: SessionAgent, uri: string) => {
    return cached(ctx, ["topicVersion", uri], async () => getTopicVersion(ctx, agent, uri))
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


export const getTopicVersion = async (ctx: AppContext, agent: SessionAgent, uri: string): Promise<{
    data?: TopicView,
    error?: string
}> => {
    const {did, rkey} = splitUri(uri)
    const topic = await ctx.db.record.findFirst({
        select: {
            uri: true,
            cid: true,
            author: {
                select: {
                    did: true,
                    handle: true,
                    displayName: true,
                    avatar: true
                }
            },
            record: true,
            createdAt: true,
            content: {
                select: {
                    text: true,
                    format: true,
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
            authorId: did, // cuando esté estable la collection pasamos a usar uri
            rkey: rkey
        }
    })

    if (!topic || !topic.content || !topic.content.topicVersion) {
        return {error: "No se encontró la versión."}
    }

    let text: string | null = null
    if (!topic.content.text) {
        if (topic.content.textBlob) {
            [text] = await fetchTextBlobs(
                ctx,
                [topic.content.textBlob]
            )
        }
    } else {
        text = topic.content.text
    }

    const author = dbUserToProfileViewBasic(topic.author)

    const id = topic.content.topicVersion.topic.id

    if (!author || !topic.cid) {
        return {error: "No se encontró el tema " + id + "."}
    }

    const {text: transformedText, format: transformedFormat} = anyEditorStateToMarkdownOrLexical(text, topic.content.format)

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
}, TopicView> = async (ctx, agent, {params}) => {
    const {did, rkey} = params
    return getCachedTopicVersion(ctx, agent, getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey))
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
    const m = await getSynonymsToTopicsMap(ctx)
    const refs = getTopicsReferencedInText(text + " " + title, m)
    const titles = await getTopicsTitles(ctx, refs.map(r => r.topicId))
    const data = refs
        .map(r => ({id: r.topicId, count: r.count, title: gett(titles, r.topicId)}))
        .sort((a, b) => (b.count - a.count))
    return {
        data
    }
}


export const getAllTopics: CAHandlerNoAuth<{}, {topicId: string, uri: string}[]> = async (ctx, agent, {}) => {
    const topicVersions = await ctx.db.topicVersion.findMany({
        select: {
            topicId: true,
            uri: true,
            categories: true
        }
    })
    return {data: topicVersions}
}