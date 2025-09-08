import {FeedPipelineProps, GetSkeletonProps} from "#/services/feed/feed";
import {CAHandler} from "#/utils/handler";
import {
    isRecord as isPostRecord,
    Record as PostRecord,
    validateRecord as validatePostRecord
} from "#/lex-api/types/app/bsky/feed/post";
import {
    isRecord as isArticleRecord,
    Record as ArticleRecord,
    validateRecord as validateArticleRecord
} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {processArticle, processPost} from "#/services/sync/process-event";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {$Typed} from "@atproto/api";
import {sql} from "kysely";
import {redisDeleteByPrefix} from "#/services/user/follow-suggestions";
import {
    followingFeedCursorToScore, followingFeedScoreToCursor,
    getCachedSkeleton,
    GetNextCursor,
    getNextFollowingFeedCursor,
    SkeletonQuery
} from "#/services/feed/inicio/following";


export function getEnDiscusionStartDate(time: EnDiscusionTime) {
    const oneDay = 3600 * 24 * 1000
    if (time == "Último día") {
        return new Date(Date.now() - oneDay)
    } else if (time == "Última semana") {
        return new Date(Date.now() - 7 * oneDay)
    } else if (time == "Último mes") {
        return new Date(Date.now() - 30 * oneDay)
    } else {
        throw Error(`Período de tiempo inválido: ${time}`)
    }
}


export type EnDiscusionMetric = "Me gustas" | "Interacciones" | "Popularidad relativa" | "Recientes"
export type EnDiscusionTime = "Último día" | "Última semana" | "Último mes"
export type FeedFormatOption = "Todos" | "Artículos"

export type EnDiscusionSkeletonElement = {uri: string, createdAt: Date}

const getEnDiscusionSkeletonQuery: (metric: EnDiscusionMetric, time: EnDiscusionTime, format: FeedFormatOption) => SkeletonQuery<EnDiscusionSkeletonElement> = (metric, time, format) => {
    return async (ctx, agent, from, to, limit) => {
        const startDate = getEnDiscusionStartDate(time)
        const collections = format == "Artículos" ? ["ar.cabildoabierto.feed.article"] : ["ar.cabildoabierto.feed.article", "app.bsky.feed.post"]
        const label = 'ca:en discusión'

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
                .selectFrom('Record')
                .where('Record.collection', 'in', collections)
                .innerJoin('Content', 'Record.uri', 'Content.uri')
                .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
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
                .selectFrom('Record')
                .where('Record.collection', 'in', collections)
                .where("Record.created_at", ">", startDate)
                .innerJoin(
                    'Content',
                    'Record.uri',
                    'Content.uri'
                )
                .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
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

            const res = await ctx.kysely.selectFrom('Record')
                .where('Record.collection', 'in', collections)
                .where("Record.created_at", ">", startDate)
                .innerJoin('Content', 'Record.uri', 'Content.uri')
                .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
                .select(eb => [
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

            const res = await ctx.kysely.selectFrom('Record')
                .where('Record.collection', 'in', collections)
                .$if(offsetFrom != null, qb => qb.where("Record.created_at", "<", offsetFrom!))
                .$if(offsetTo != null, qb => qb.where("Record.created_at", ">", offsetTo!))
                .innerJoin('Content', 'Record.uri', 'Content.uri')
                .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
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


export const getNextCursorEnDiscusion: (metric: EnDiscusionMetric, time: EnDiscusionTime, format: FeedFormatOption) => GetNextCursor<EnDiscusionSkeletonElement> = (metric, time, format) => {
    return (cursor, skeleton, limit) => {
        if(metric == "Recientes"){
            return getNextFollowingFeedCursor(
                cursor,
                skeleton.map(s => ({
                    ...s,
                    repostedRecordUri: undefined
                })),
                limit
            )
        } else {
            const cur = cursor ? Number(cursor) : 0
            if(skeleton.length < limit) return undefined
            return (cur - 1 + skeleton.length).toString()
        }
    }
}


export function enDiscusionFeedCursorToScore(cursor: string) {
    return -Number(cursor)
}


export function enDiscusionFeedScoreToCursor(score: number) {
    return (-score).toString()
}


export const getEnDiscusionSkeleton: (metric: EnDiscusionMetric, time: EnDiscusionTime, format: FeedFormatOption) => GetSkeletonProps = (metric, time, format) => async (
    ctx, agent, data, cursor
) => {
    const redisKey = `endiscusion-skeleton:${metric}:${time}:${format}`
    const res = await getCachedSkeleton(
        ctx,
        agent,
        redisKey,
        getEnDiscusionSkeletonQuery(metric, time, format),
        getNextCursorEnDiscusion(metric, time, format),
        metric == "Recientes" ? followingFeedCursorToScore : enDiscusionFeedCursorToScore,
        metric == "Recientes" ? followingFeedScoreToCursor : enDiscusionFeedScoreToCursor,
        25,
        cursor
    )

    return {
        skeleton: res.skeleton.map(r => ({post: r.uri})),
        cursor: res.cursor
    }
}


export const getEnDiscusionFeedPipeline = (
    metric: EnDiscusionMetric = "Me gustas", time: EnDiscusionTime = "Último día", format: FeedFormatOption = "Todos"): FeedPipelineProps => {
    return {
        getSkeleton: getEnDiscusionSkeleton(metric, time, format)
    }
}


export const addToEnDiscusion: CAHandler<{
    params: { collection: string, rkey: string }
}, {}> = async (ctx, agent, {params}) => {
    // TO DO: Pasar a processUpdate
    const {collection, rkey} = params
    const did = agent.did

    const res = await agent.bsky.com.atproto.repo.getRecord({
        repo: did,
        collection,
        rkey
    })

    if (!res.success) {
        return {error: "No se pudo agregar a en discusión."}
    }

    const record = res.data.value

    const validatePost = validatePostRecord(record)
    const validateArticle = validateArticleRecord(record)

    let validRecord: $Typed<PostRecord> | $Typed<ArticleRecord> | undefined
    if (validatePost.success) {
        validRecord = {...validatePost.value, $type: "app.bsky.feed.post"}
    } else if (validateArticle.success) {
        validRecord = {...validateArticle.value, $type: "ar.cabildoabierto.feed.article"}
    }

    if (validRecord) {
        if (validRecord.labels && isSelfLabels(validRecord.labels)) {
            validRecord.labels.values.push({val: "ca:en discusión"})
        } else if (!validRecord.labels) {
            validRecord.labels = {
                $type: "com.atproto.label.defs#selfLabels",
                values: [{val: "ca:en discusión"}]
            }
        }

        const ref = await agent.bsky.com.atproto.repo.putRecord({
            repo: did,
            collection,
            rkey,
            record: validRecord
        })

        if (isArticleRecord(validRecord)) {
            await processArticle(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord)
        } else {
            await processPost(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord)
        }
    } else {
        return {error: "No se pudo agregar a en discusión."}
    }

    await redisDeleteByPrefix(ctx, "endiscusion-skeleton")

    return {data: {}}
}


export const removeFromEnDiscusion: CAHandler<{
    params: { collection: string, rkey: string }
}, {}> = async (ctx, agent, {params}) => {
    // TO DO: Pasar a processUpdate
    const {collection, rkey} = params
    const did = agent.did

    const res = await agent.bsky.com.atproto.repo.getRecord({
        repo: did,
        collection,
        rkey
    })

    if (!res.success) {
        return {error: "No se pudo remover de en discusión."}
    }

    const record = res.data.value

    const validatePost = validatePostRecord(record)
    const validateArticle = validateArticleRecord(record)

    let validRecord: PostRecord | ArticleRecord | undefined
    if (validatePost.success) {
        validRecord = validatePost.value
    } else if (validateArticle.success) {
        validRecord = validateArticle.value
    }

    if (validRecord) {
        if (validRecord.labels && isSelfLabels(validRecord.labels)) {
            validRecord.labels.values = validRecord.labels.values.filter(v => v.val != "ca:en discusión")
        }

        const ref = await agent.bsky.com.atproto.repo.putRecord({
            repo: did,
            collection,
            rkey,
            record: validRecord
        })

        if (isArticleRecord(record)) {
            await processArticle(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord as ArticleRecord)
        } else if (isPostRecord(record)) {
            await processPost(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord as PostRecord)
        }
    } else {
        return {error: "No se pudo remover de en discusión."}
    }

    await redisDeleteByPrefix(ctx, "endiscusion-skeleton")

    return {data: {}}
}