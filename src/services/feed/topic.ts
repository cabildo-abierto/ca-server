import {FeedViewContent, isFeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {FeedSkeleton, getFeed, GetSkeletonProps} from "#/services/feed/feed";
import {AppContext} from "#/index";
import {Agent} from "#/utils/session-agent";
import {creationDateSortKey} from "#/services/feed/utils";
import {hydrateFeedViewContent} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {isNotFoundPost} from "#/lex-server/types/app/bsky/feed/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";
import {getTopicTitle} from "#/services/wiki/utils";
import {
    TopicProp,
} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {getUri} from "#/utils/uri";
import {isPostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {
    isView as isSelectionQuoteEmbed
} from "#/lex-api/types/ar/cabildoabierto/embed/selectionQuote"
import {
    enDiscusionFeedCursorToScore, enDiscusionFeedScoreToCursor,
    EnDiscusionMetric, EnDiscusionSkeletonElement,
    EnDiscusionTime,
    FeedFormatOption,
    getEnDiscusionStartDate, getNextCursorEnDiscusion
} from "#/services/feed/inicio/discusion";
import {sql} from "kysely";
import {
    followingFeedCursorToScore,
    followingFeedScoreToCursor,
    getCachedSkeleton, SkeletonQuery
} from "#/services/feed/inicio/following";


const getTopicRepliesSkeleton = async (ctx: AppContext, id: string) => {
    const replies = await ctx.db.record.findMany({
        select: {uri: true},
        where: {
            OR: [
                {
                    content: {
                        post: {
                            replyTo: {
                                collection: {
                                    in: ["ar.com.cabildoabierto.topic", "ar.cabildoabierto.wiki.topicVersion"]
                                },
                                content: {
                                    topicVersion: {
                                        topicId: id
                                    }
                                }
                            }
                        }
                    }
                },
            ]
        },
        orderBy: {
            createdAt: "desc"
        }
    })
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
                .selectFrom("Record")
                .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
                .leftJoin("Post", "Post.uri", "Record.uri")
                .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
                .where("Reference.referencedTopicId", "=", id)
                .where("Record.collection", "in", collections)
                .where(eb => eb.or([
                    eb("TopicVersion.topicId", "!=", id),
                    eb("TopicVersion.uri", "is", null)
                ]))
                .where("Record.created_at", ">", startDate)
                .select(eb => [
                    'Record.uri',
                    "Record.created_at as createdAt",
                    eb(
                        "Record.uniqueLikesCount",
                        "-",
                        eb.case()
                            .when(
                                eb.exists(eb.selectFrom('Reaction')
                                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                                    .whereRef("Reaction.subjectId", "=", "Record.uri")
                                    .where('ReactionRecord.collection', '=', 'app.bsky.feed.like')
                                    .whereRef('ReactionRecord.authorId', '=', 'Record.authorId'))
                            )
                            .then(1).else(0)
                            .end()
                    ).as("score")
                ])
                .orderBy(["score desc", "Record.created_at desc"])
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
                .selectFrom("Record")
                .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
                .leftJoin("Post", "Post.uri", "Record.uri")
                .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
                .where("Reference.referencedTopicId", "=", id)
                .where("Record.collection", "in", collections)
                .where(eb => eb.or([
                    eb("TopicVersion.topicId", "!=", id),
                    eb("TopicVersion.uri", "is", null)
                ]))
                .where("Record.created_at", ">", startDate)
                .select([
                    'Record.uri',
                    "Record.created_at as createdAt",
                    sql<number>`
                    "Record"."uniqueLikesCount" + 
                    "Record"."uniqueRepostsCount" +
                    (select count("Post"."uri") as "count" from "Post"
                    inner join "Record" as "ReplyRecord" on "Post"."uri" = "ReplyRecord"."uri"
                    where 
                        "Post"."replyToId" = "Record"."uri" and
                        "ReplyRecord"."authorId" != "Record"."authorId"
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on "Reaction"."uri" = "Record"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.repost'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"    
                        ) then 1 else 0 end
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on "Reaction"."uri" = "Record"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.like'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"    
                        ) then 1 else 0 end
                    )
                `.as("score")
                ])
                .orderBy(["score desc", "created_at desc"])
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
                .selectFrom("Record")
                .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
                .leftJoin("Post", "Post.uri", "Record.uri")
                .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
                .where("Reference.referencedTopicId", "=", id)
                .where("Record.collection", "in", collections)
                .where(eb => eb.or([
                    eb("TopicVersion.topicId", "!=", id),
                    eb("TopicVersion.uri", "is", null)
                ]))
                .where("Record.created_at", ">", startDate)
                .select([
                    'Record.uri',
                    "Record.created_at as createdAt",
                    sql<number>`
                    ("Record"."uniqueLikesCount" + 
                    "Record"."uniqueRepostsCount" +
                    (select count("Post"."uri") as "count" from "Post"
                    inner join "Record" as "ReplyRecord" on "Post"."uri" = "ReplyRecord"."uri"
                    where 
                        "Post"."replyToId" = "Record"."uri" and
                        "ReplyRecord"."authorId" != "Record"."authorId"
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on "Reaction"."uri" = "Record"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.repost'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"    
                        ) then 1 else 0 end
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on "Reaction"."uri" = "Record"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.like'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"    
                        ) then 1 else 0 end
                    ))::numeric / sqrt(1 + (
                        select count(distinct "Follower"."did") from "Follow"
                        inner join "Record" as "FollowRecord" on "Follow"."uri" = "FollowRecord"."uri"
                        inner join "User" as "Follower" on "FollowRecord"."authorId" = "Follower"."did"
                        where "Follower"."inCA" = true
                        and "Follow"."userFollowedId" = "Record"."authorId"
                    ))
                `.as("score"),
                ])
                .orderBy(["score desc", "createdAt desc"])
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


export function topicMentionsSkeletonRedisKey(id: string, metric: EnDiscusionMetric, time: EnDiscusionTime, format: FeedFormatOption){
    return `topic-mentions-skeleton:${id}:${metric}:${time}:${format}`
}


export function topicMentionsSkeletonRedisKeyTopicPrefix(id: string){
    return `topic-mentions-skeleton:${id}:`
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

    const skeleton = await getCachedSkeleton(
        ctx,
        agent,
        topicMentionsSkeletonRedisKey(id, metric, time, format),
        getTopicMentionsSkeletonQuery(id, metric, time, format),
        getNextCursorEnDiscusion(metric, time, format),
        metric == "Recientes" ? followingFeedCursorToScore : enDiscusionFeedCursorToScore,
        metric == "Recientes" ? followingFeedScoreToCursor : enDiscusionFeedScoreToCursor,
        25,
        cursor
    )

    return {
        skeleton: skeleton.skeleton.map(x => ({post: x.uri})),
        cursor: skeleton.cursor
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
        .map((e) => (hydrateFeedViewContent(e, data)))

    feed.filter(isNotFoundPost).forEach(x => {
        console.log("Content not found:", x.uri)
    })

    let res = feed
        .filter(x => isFeedViewContent(x))

    res = sortByKey(res, creationDateSortKey, listOrderDesc)

    return res
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
            id = await getTopicIdFromTopicVersionUri(ctx.db, did, rkey) ?? undefined
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

        const mentions = await getFeed({
            ctx,
            agent,
            pipeline: {
                getSkeleton
            },
            cursor
        })

        return {
            data: mentions.data
        }
    } else {
        return {error: "Solicitud inválida."}
    }
}


export const getTopicMentionsInTopicsFeed: CAHandler<{ query: { i?: string, did?: string, rkey?: string } }, {
    feed: {id: string, title: string}[],
    cursor: string | undefined
}> = async (ctx, agent, {query}) => {
    let {i: id, did, rkey} = query

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

    const topicMentions = await getTopicMentionsInTopics(ctx, id)

    return {
        data: {
            feed: topicMentions,
            cursor: undefined
        }
    }
}


export const getTopicQuoteReplies: CAHandler<{params: {did: string, rkey: string}}, PostView[]> = async (ctx, agent, {params}) => {
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