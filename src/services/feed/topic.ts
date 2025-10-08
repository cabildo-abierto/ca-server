import {FeedViewContent, isPostView, PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs.js";
import {CAHandlerNoAuth} from "#/utils/handler.js";
import {FeedSkeleton, getFeed, GetSkeletonProps} from "#/services/feed/feed.js";
import {AppContext} from "#/setup.js";
import {Agent} from "#/utils/session-agent.js";
import {creationDateSortKey} from "#/services/feed/utils.js";
import {hydrateFeedViewContent} from "#/services/hydration/hydrate.js";
import {listOrderDesc, sortByKey} from "#/utils/arrays.js";
import {Dataplane} from "#/services/hydration/dataplane.js";
import {getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version.js";
import {getTopicTitle} from "#/services/wiki/utils.js";
import {TopicProp,} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js";
import {getUri} from "#/utils/uri.js";
import {isView as isSelectionQuoteEmbed} from "#/lex-api/types/ar/cabildoabierto/embed/selectionQuote.js"
import {
    EnDiscusionMetric,
    EnDiscusionSkeletonElement,
    EnDiscusionTime,
    FeedFormatOption,
    getEnDiscusionStartDate,
    getNextCursorEnDiscusion
} from "#/services/feed/inicio/discusion.js";
import {SkeletonQuery} from "#/services/feed/inicio/following.js";


const getTopicRepliesSkeleton = async (ctx: AppContext, id: string) => {
    const replies = await ctx.kysely
        .selectFrom("Post")
        .innerJoin("Record", "Record.uri", "Post.uri")
        .innerJoin("Record as Parent", "Parent.uri", "Post.replyToId")
        .innerJoin("TopicVersion", "TopicVersion.uri", "Parent.uri")
        .select([
            "Post.uri",
        ])
        .where("TopicVersion.topicId", "=", id)
        .orderBy("Record.created_at desc")
        .execute()
    return replies.map(r => ({post: r.uri}))
}


const getTopicMentionsSkeletonQuery: (id: string, metric: EnDiscusionMetric, time: EnDiscusionTime, format: FeedFormatOption) => SkeletonQuery<EnDiscusionSkeletonElement> = (id, metric, time, format) => {
    return async (ctx, agent, from, to, limit) => {
        const startDate = getEnDiscusionStartDate(time)
        const collections = format == "Artículos" ? ["ar.cabildoabierto.feed.article"] : ["ar.cabildoabierto.feed.article", "app.bsky.feed.post"]

        if(limit == 0){
            return []
        }

        if(metric == "Me gustas"){
            const offsetFrom = from != null ? Number(from)+1 : 0
            const offsetTo = to != null ? Number(to) : undefined
            if(offsetTo != null){
                limit = Math.min(limit, offsetTo - offsetFrom)
            }

            if(limit == 0) return []

            const res = await ctx.kysely
                .selectFrom("Content")
                .innerJoin("Record", "Record.uri", "Content.uri")
                .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
                .leftJoin("Post", "Post.uri", "Record.uri")
                .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
                .innerJoin("User", "User.did", "Record.authorId")
                .where("User.inCA", "=", true)
                .where("Reference.referencedTopicId", "=", id)
                .where("Record.collection", "in", collections)
                .where(eb => eb.or([
                    eb("TopicVersion.topicId", "!=", id),
                    eb("TopicVersion.uri", "is", null)
                ]))
                .where("Record.created_at", ">", startDate)
                .select(eb => [
                    'Record.uri',
                    "Record.created_at as createdAt"
                ])
                .orderBy(["likesScore desc", "Content.created_at desc"])
                .limit(limit)
                .offset(offsetFrom)
                .execute()

            return res.map((r, i) => ({
                ...r,
                score: -(i + offsetFrom)
            }))
        } else if(metric == "Interacciones"){
            const offsetFrom = from != null ? Number(from)+1 : 0
            const offsetTo = to != null ? Number(to) : undefined
            if(offsetTo != null){
                limit = Math.min(limit, offsetTo - offsetFrom)
            }

            if(limit == 0) return []
            const res = await ctx.kysely
                .selectFrom("Content")
                .innerJoin("Record", "Record.uri", "Content.uri")
                .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
                .leftJoin("Post", "Post.uri", "Record.uri")
                .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
                .innerJoin("User", "User.did", "Record.authorId")
                .where("User.inCA", "=", true)
                .where("Reference.referencedTopicId", "=", id)
                .where("Record.collection", "in", collections)
                .where(eb => eb.or([
                    eb("TopicVersion.topicId", "!=", id),
                    eb("TopicVersion.uri", "is", null)
                ]))
                .where("Record.created_at", ">", startDate)
                .where("interactionsScore", "is not", null)
                .select([
                    'Record.uri',
                    "Record.created_at as createdAt"
                ])
                .orderBy(["interactionsScore desc", "Content.created_at desc"])
                .limit(limit)
                .offset(offsetFrom)
                .execute()

            return res.map((r, i) => ({
                ...r,
                score: -(i + offsetFrom)
            }))
        } else if(metric == "Popularidad relativa"){
            const offsetFrom = from != null ? Number(from)+1 : 0
            const offsetTo = to != null ? Number(to) : undefined
            if(offsetTo != null){
                limit = Math.min(limit, offsetTo - offsetFrom)
            }

            if(limit == 0) return []

            const res = await ctx.kysely
                .selectFrom("Content")
                .innerJoin("Record", "Record.uri", "Content.uri")
                .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
                .leftJoin("Post", "Post.uri", "Record.uri")
                .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
                .innerJoin("User", "User.did", "Record.authorId")
                .where("User.inCA", "=", true)
                .where("Reference.referencedTopicId", "=", id)
                .where("Record.collection", "in", collections)
                .where(eb => eb.or([
                    eb("TopicVersion.topicId", "!=", id),
                    eb("TopicVersion.uri", "is", null)
                ]))
                .where("Record.created_at", ">", startDate)
                .select([
                    'Record.uri',
                    "Record.created_at as createdAt"
                ])
                .orderBy(["relativePopularityScore desc", "Content.created_at desc"])
                .limit(limit)
                .offset(offsetFrom)
                .execute()

            return res.map((r, i) => ({
                ...r,
                score: -(i + offsetFrom)
            }))
        } else if(metric == "Recientes"){
            const offsetFrom = from != null ? new Date(from) : undefined
            const offsetTo = to != null ? new Date(to) : undefined

            if(offsetFrom && offsetTo && offsetFrom.getTime() <= offsetTo.getTime()) return []

            const res = await ctx.kysely
                .selectFrom("Record")
                .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
                .leftJoin("Post", "Post.uri", "Record.uri")
                .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
                .innerJoin("User", "User.did", "Record.authorId")
                .where("User.inCA", "=", true)
                .where("Reference.referencedTopicId", "=", id)
                .where("Record.collection", "in", collections)
                .where(eb => eb.or([
                    eb("TopicVersion.topicId", "!=", id),
                    eb("TopicVersion.uri", "is", null)
                ]))
                .$if(offsetFrom != null, qb => qb.where("Record.created_at", "<", offsetFrom!))
                .$if(offsetTo != null, qb => qb.where("Record.created_at", ">", offsetTo!))
                .select([
                    'Record.uri',
                    "Record.created_at as createdAt"
                ])
                .orderBy('Record.created_at', 'desc')
                .limit(limit)
                .execute()
            return res.map(r => ({
                uri: r.uri,
                createdAt: r.createdAt,
                score: r.createdAt.getTime()
            }))
        } else {
            throw Error(`Métrica desconocida! ${metric}`)
        }
    }
}


const getTopicMentionsSkeleton = async (
    ctx: AppContext,
    agent: Agent,
    data: Dataplane,
    id: string,
    cursor: string | undefined,
    metric: EnDiscusionMetric,
    time: EnDiscusionTime,
    format: FeedFormatOption
): Promise<{skeleton: FeedSkeleton, cursor: string | undefined}> => {

    const limit = 25

    const skeleton = await getTopicMentionsSkeletonQuery(
        id, metric, time, format
    )(ctx, agent, cursor, undefined, limit)

    return {
        skeleton: skeleton.map(x => ({post: x.uri})),
        cursor: getNextCursorEnDiscusion(metric, time, format)(cursor, skeleton, limit)
    }
}


export async function getTopicMentionsInTopics(ctx: AppContext, id: string){
    const topics = await ctx.kysely
        .selectFrom("TopicVersion")
        .innerJoin("Record", "Record.uri", "TopicVersion.uri")
        .where("Record.collection", "=", "ar.cabildoabierto.wiki.topicVersion")
        .select("topicId")
        .where(eb => eb.exists(eb => eb
            .selectFrom("Reference")
            .where("Reference.referencedTopicId", "=", id)
            .whereRef("Reference.referencingContentId", "=", "TopicVersion.uri")
        ))
        .innerJoin("Topic", "Topic.currentVersionId", "TopicVersion.uri")
        .select(["TopicVersion.topicId", "TopicVersion.props"])
        .orderBy("created_at", "desc")
        .limit(25)
        .execute()

    return topics.map(t => {
        return {
            id: t.topicId,
            title: getTopicTitle({id: t.topicId, props: t.props as TopicProp[]})
        }
    })
}


async function hydrateRepliesSkeleton(ctx: AppContext, agent: Agent, skeleton: FeedSkeleton){
    const data = new Dataplane(ctx, agent)
    await data.fetchFeedHydrationData(skeleton)

    let feed = skeleton
        .map((e) => (hydrateFeedViewContent(ctx, e, data)))

    return sortByKey(
        feed.filter(x => x != null),
        creationDateSortKey,
        listOrderDesc
    )
}


export const getTopicVersionReplies = async (ctx: AppContext, agent: Agent, id: string): Promise<{data?: FeedViewContent[], error?: string}> => {
    const skeleton = await getTopicRepliesSkeleton(ctx, id)
    const res = await hydrateRepliesSkeleton(ctx, agent, skeleton)

    return {data: res}
}


export const getTopicFeed: CAHandlerNoAuth<{ params: {kind: "mentions" | "discussion"}, query: { i?: string, did?: string, rkey?: string, cursor?: string, metric?: EnDiscusionMetric, time?: EnDiscusionTime, format?: FeedFormatOption } }, {
    feed: FeedViewContent[],
    cursor?: string
}> = async (ctx, agent, {query, params}) => {
    let {i: id, did, rkey, cursor, metric, time, format} = query
    const {kind} = params

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

    if(kind == "discussion"){
        const replies = await getTopicVersionReplies(ctx, agent, id)
        if(!replies.data) return {error: replies.error}

        return {
            data: {
                feed: replies.data,
                cursor: undefined
            }
        }
    } else if(kind == "mentions"){
        const getSkeleton: GetSkeletonProps = async (ctx, agent, data, cursor) => {
            return await getTopicMentionsSkeleton(
                ctx,
                agent,
                data,
                id,
                cursor,
                metric ?? "Interacciones",
                time ?? "Última semana",
                format ?? "Todos"
            )
        }

        try {
            return await getFeed({
                ctx,
                agent,
                pipeline: {
                    getSkeleton
                },
                cursor
            })
        } catch (error) {
            ctx.logger.pino.error({error}, "error getting mentions feed")
            return {error: "Ocurrió un error al obtener el muro."}
        }
    } else {
        return {error: "Solicitud inválida."}
    }
}


export const getTopicMentionsInTopicsFeed: CAHandlerNoAuth<{ query: { i?: string, did?: string, rkey?: string } }, {
    feed: {id: string, title: string}[],
    cursor: string | undefined
}> = async (ctx, agent, {query}) => {
    let {i: id, did, rkey} = query

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

    const topicMentions = await getTopicMentionsInTopics(ctx, id)

    return {
        data: {
            feed: topicMentions,
            cursor: undefined
        }
    }
}


export const getTopicQuoteReplies: CAHandlerNoAuth<{params: {did: string, rkey: string}}, PostView[]> = async (ctx, agent, {params}) => {
    const {did, rkey} = params
    const uri = getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey)

    const skeleton = (await ctx.kysely
        .selectFrom("Post")
        .where("Post.replyToId", "=", uri)
        .select("uri")
        .execute()).map(p => ({post: p.uri}))

    const hydrated = await hydrateRepliesSkeleton(ctx, agent, skeleton)

    const posts: PostView[] = hydrated
        .map(c => c.content)
        .filter(c => isPostView(c))
        .filter(c => isSelectionQuoteEmbed(c.embed))

    return {
        data: posts
    }
}