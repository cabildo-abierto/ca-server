import {fetchBlob, fetchTextBlobs} from "../blob";
import {getDidFromUri, getUri, splitUri} from "#/utils/uri";
import {AppContext} from "#/index";
import {CAHandler, CAHandlerOutput} from "#/utils/handler";
import {
    CategoryVotes,
    TopicHistory,
    TopicProp,
    TopicVersionStatus,
    TopicView,
    VersionInHistory
} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {TopicViewBasic} from "#/lex-server/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicCurrentVersion} from "#/services/topic/current-version";
import {SessionAgent} from "#/utils/session-agent";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms";
import { Prisma } from "@prisma/client";
import {Dataplane, getBlobKey} from "#/services/hydration/dataplane";
import {$Typed} from "@atproto/api";
import {logTimes} from "#/utils/utils";


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

    const topics = await ctx.db.$queryRawUnsafe(`
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
                                WHERE prop ->>'name' = 'Categorías'
                    AND (prop->'value'->'value')::jsonb @> $1::jsonb)
                )
                OR
            (
                ${categories.length === 0 ? 'TRUE' : 'FALSE'}
            )
        )
        ORDER BY ${orderByClause} LIMIT $2
    `, jsonbArray, limit)

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
    const q = data.data.topicsByUri?.get(uri)
    if(!q) return {error: "No se pudo encontrar el tema."}

    return {data: topicQueryResultToTopicViewBasic(q)}
}


export function hydrateTopicViewBasicFromTopicId(id: string, data: Dataplane) {
    const q = data.data.topicsById?.get(id)
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
}) {
    if (!author.handle) return null
    return {
        did: author.did,
        handle: author.handle,
        displayName: author.displayName ?? undefined,
        avatar: author.avatar ?? undefined,
    }
}


export const getTopicHistory: CAHandler<{ params: { id: string } }, TopicHistory> = async (ctx, agent, {params}) => {
    const {id} = params
    try {
        const versions = await ctx.db.record.findMany({
            select: {
                uri: true,
                cid: true,
                createdAt: true,
                author: {
                    select: {
                        did: true,
                        handle: true,
                        displayName: true,
                        avatar: true
                    }
                },
                content: {
                    select: {
                        textBlob: true,
                        text: true,
                        topicVersion: {
                            select: {
                                charsAdded: true,
                                charsDeleted: true,
                                accCharsAdded: true,
                                contribution: true,
                                diff: true,
                                message: true,
                                props: true,
                                title: true
                            }
                        }
                    }
                },
                accepts: {
                    select: {
                        uri: true
                    }
                },
                rejects: {
                    select: {
                        uri: true
                    }
                }
            },
            where: {
                content: {
                    topicVersion: {
                        topicId: id
                    }
                },
                cid: {
                    not: null
                }
            },
            orderBy: {
                createdAt: "asc"
            }
        })

        const topicHistory: TopicHistory = {
            id,
            versions: versions.map(v => {
                if (!v.content || !v.content.topicVersion || !v.cid) return null

                let accept: string | undefined
                let reject: string | undefined

                const voteCounts: CategoryVotes[] = [
                    {
                        accepts: v.accepts.length,
                        rejects: v.rejects.length,
                        category: "Beginner" // TO DO
                    }
                ]

                v.accepts.forEach(a => {
                    const did = getDidFromUri(a.uri)
                    if (did == agent.did) {
                        accept = a.uri
                    }
                })

                v.rejects.forEach(a => {
                    const did = getDidFromUri(a.uri)
                    if (did == agent.did) {
                        reject = a.uri
                    }
                })

                const author = dbUserToProfileViewBasic(v.author)
                if (!author) return null

                const status: TopicVersionStatus = {
                    voteCounts
                }

                const props: TopicProp[] = v.content.topicVersion.props as unknown as TopicProp[]

                const view: VersionInHistory = {
                    $type: "ar.cabildoabierto.wiki.topicVersion#versionInHistory",
                    uri: v.uri,
                    cid: v.cid,
                    author,
                    message: v.content.topicVersion.message,
                    viewer: {
                        accept,
                        reject
                    },
                    status: status,
                    addedChars: v.content.topicVersion.charsAdded ?? undefined,
                    removedChars: v.content.topicVersion.charsDeleted ?? undefined,
                    props: props,
                    createdAt: v.createdAt.toISOString()
                }
                return view
            }).filter(v => v != null)
        }

        return {data: topicHistory}
    } catch (e) {
        console.error("Error getting topic " + id)
        console.error(e)
        return {error: "No se pudo obtener el historial."}
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
    const cur = await ctx.redis.get(strKey)
    if (cur) return {data: JSON.parse(cur) as T}
    const res = await fn()
    if (res.data) {
        await ctx.redis.set(strKey, JSON.stringify(res))
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


export const getTopic = async (ctx: AppContext, agent: SessionAgent, id: string): Promise<{
    data?: TopicView,
    error?: string
}> => {
    const t1 = Date.now()
    const {data: currentVersionId} = await cached(ctx, ["currentVersion", id], async () => getTopicCurrentVersionFromDB(ctx, agent, id))
    const t2 = Date.now()
    let uri: string
    if (!currentVersionId) {
        console.log(`Warning: Current version not set for topic ${id}.`)
        const {data: history} = await getTopicHistory(ctx, agent, {params: {id}})

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
    const t3 = Date.now()

    const res = await getCachedTopicVersion(ctx, agent, uri)

    const t4 = Date.now()

    logTimes("getTopic", [t1, t2, t3, t4])
    return res
}


export const getTopicHandler: CAHandler<{ params: { id: string } }, TopicView> = async (ctx, agent, {params: {id}}) => {
    return getTopic(ctx, agent, id)
}


export const getCachedTopicVersion = async (ctx: AppContext, agent: SessionAgent, uri: string) => {
    return cached(ctx, ["topicVersion", uri], async () => getTopicVersion(ctx, agent, uri))
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
        console.log(author != null, topic.cid != null)
        return {error: "No se encontró el tema " + id + "."}
    }

    const {text: transformedText, format: transformedFormat} = anyEditorStateToMarkdownOrLexical(text, topic.content.format)

    const view: TopicView = {
        $type: "ar.cabildoabierto.wiki.topicVersion#topicView",
        id,
        uri: topic.uri,
        cid: topic.cid,
        author,
        text: transformedText,
        format: transformedFormat,
        props: topic.content.topicVersion.props as unknown as TopicProp[],
        createdAt: topic.createdAt.toISOString(),
        lastEdit: topic.content.topicVersion.topic.lastEdit?.toISOString() ?? topic.createdAt.toISOString(),
        currentVersion: topic.content.topicVersion.topic.currentVersionId ?? undefined,
        record: topic.record ? JSON.parse(topic.record) : undefined
    }

    return {data: view}
}


export const getTopicVersionHandler: CAHandler<{
    params: { did: string, rkey: string }
}, TopicView> = async (ctx, agent, {params}) => {
    const {did, rkey} = params
    return getCachedTopicVersion(ctx, agent, getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey))
}


/*

function showAuthors(topic: TopicHistoryProps, topicVersion: TopicVersionProps) {
    const versionText = topicVersion.content.text

    function newAuthorNode(authors: string[], childNode){
        const authorNode: SerializedAuthorNode = {
            children: [childNode],
            type: "author",
            authors: authors,
            direction: 'ltr',
            version: childNode.version,
            format: 'left',
            indent: 0
        }
        return authorNode
    }

    const parsed = editorStateFromJSON(versionText)
    if(!parsed) {
        return versionText
    }
    let prevNodes = []
    let prevAuthors = []

    for(let i = 0; i < topic.versions.length; i++){
        const parsedVersion = editorStateFromJSON(decompress(topic.versions[i].content.text))
        if(!parsedVersion) continue
        const nodes = parsedVersion.root.children
        const {matches} = JSON.parse(topic.versions[i].content.topicVersion.diff)
        const versionAuthor = topic.versions[i].author.did
        let nodeAuthors: string[] = []
        for(let j = 0; j < nodes.length; j++){
            let authors = null
            for(let k = 0; k < matches.length; k++){
                if(matches[k] && matches[k].y == j){
                    const prevNodeAuthors = prevAuthors[matches[k].x]
                    if(getAllText(prevNodes[matches[k].x]) == getAllText(nodes[matches[k].y])){
                        authors = prevNodeAuthors
                    } else {
                        if(!prevNodeAuthors.includes(versionAuthor)){
                            authors = [...prevNodeAuthors, versionAuthor]
                        } else {
                            authors = prevNodeAuthors
                        }
                    }
                    break
                }
            }
            if(authors === null) authors = [versionAuthor]
            nodeAuthors.push(authors)
        }
        prevAuthors = [...nodeAuthors]
        prevNodes = [...nodes]
        if(topic.versions[i].uri == topicVersion.uri) break
    }
    const newChildren = []
    for(let i = 0; i < prevNodes.length; i++){
        newChildren.push(newAuthorNode(prevAuthors[i], prevNodes[i]))
    }
    parsed.root.children = newChildren
    return JSON.stringify(parsed)
}
 */


export const getTopicVersionAuthors: CAHandler<{
    params: { did: string, rkey: string }
}> = async (ctx, agent, {params}) => {
    const {did, rkey} = params

    return {
        data: {
            text: "Sin implementar",
            format: "markdown"
        }
    }
}


export const getTopicVersionChanges: CAHandler<{
    params: { did: string, rkey: string }
}> = async (ctx, agent, {params}) => {
    const {did, rkey} = params

    return {
        data: {
            text: "Sin implementar",
            format: "markdown"
        }
    }
}