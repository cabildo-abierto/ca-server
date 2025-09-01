import {FeedPipelineProps, FeedSkeleton, GetSkeletonProps} from "#/services/feed/feed";
import {CAHandler} from "#/utils/handler";
import {Record as PostRecord, validateRecord as validatePostRecord, isRecord as isPostRecord} from "#/lex-api/types/app/bsky/feed/post";
import {Record as ArticleRecord, validateRecord as validateArticleRecord, isRecord as isArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {processArticle, processPost} from "#/services/sync/process-event";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {$Typed} from "@atproto/api";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {sql} from "kysely";
import {redisDeleteByPrefix} from "#/services/user/follow-suggestions";


function getEnDiscusionStartDate(time: EnDiscusionTime){
    const oneDay = 3600*24*1000
    if(time == "Último día"){
        return new Date(Date.now()-oneDay)
    } else if(time == "Última semana"){
        return new Date(Date.now()-7*oneDay)
    } else if(time == "Último mes"){
        return new Date(Date.now()-30*oneDay)
    } else {
        throw Error(`Período de tiempo inválido: ${time}`)
    }
}


export type EnDiscusionMetric = "Me gustas" | "Interacciones" | "Popularidad relativa" | "Recientes"
export type EnDiscusionTime = "Último día" | "Última semana" | "Último mes"
export type FeedFormatOption = "Todos" | "Artículos"


export const getEnDiscusionSkeleton: (metric: EnDiscusionMetric, time: EnDiscusionTime, format: FeedFormatOption) => GetSkeletonProps = (metric, time, format) => async (ctx, agent, data, cursor) => {
    const redisKey = `endiscusion-skeleton:${metric}:${time}:${format}:${cursor}`
    const inCache = await ctx.ioredis.get(redisKey)
    if(inCache){
        return JSON.parse(inCache)
    }

    const startDate = getEnDiscusionStartDate(time)

    const collections = format == "Artículos" ? ["ar.cabildoabierto.feed.article"] : ["ar.cabildoabierto.feed.article", "app.bsky.feed.post"]
    const label = 'ca:en discusión'

    let skeleton: FeedSkeleton | undefined
    let nextCursor: string | undefined

    if(metric == "Me gustas"){
        let res = await ctx.kysely
            .selectFrom('Record')
            .where('Record.collection', 'in', collections)
            .innerJoin('Content', 'Record.uri', 'Content.uri')
            .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            .select(eb => [
                'Record.uri',
                'Record.uniqueLikesCount',
                'Record.uniqueRepostsCount',
                'Record.created_at',
                eb.exists(eb.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .whereRef("Reaction.subjectId", "=", "Record.uri")
                    .where('ReactionRecord.collection', '=', 'app.bsky.feed.like')
                    .whereRef('ReactionRecord.authorId', '=', 'Record.authorId')).as("autolike")
            ])
            .execute()

        res = sortByKey(res, e => {
            return [
                e.created_at > startDate ? 1 : 0,
                (e.uniqueLikesCount ?? 0) - (e.autolike ? 1 : 0),
                e.created_at.getTime()
            ];
        }, listOrderDesc);

        skeleton = res
            .map(e => ({ post: e.uri }))
            .slice(0, 25)
        nextCursor = undefined

    } else if(metric == "Interacciones"){
        let res = await ctx.kysely
            .selectFrom('Record')
            .where('Record.collection', 'in', collections)
            .innerJoin('Content', 'Record.uri', 'Content.uri')
            .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            .select(eb => [
                'Record.uri',
                'Record.uniqueLikesCount',
                'Record.uniqueRepostsCount',
                'Record.created_at',
                eb.exists(eb.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .whereRef("Reaction.subjectId", "=", "Record.uri")
                    .where('ReactionRecord.collection', '=', 'app.bsky.feed.like')
                    .whereRef('ReactionRecord.authorId', '=', 'Record.authorId')).as("autolike"),
                eb.exists(eb.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .whereRef("Reaction.subjectId", "=", "Record.uri")
                    .where('ReactionRecord.collection', '=', 'app.bsky.feed.repost')
                    .whereRef('ReactionRecord.authorId', '=', 'Record.authorId')).as("autorepost"),
                eb.selectFrom('Post')
                    .leftJoin('Record', 'Record.uri', 'Post.replyToId')
                    .innerJoin('Record as ReplyRecord', 'Post.uri', 'ReplyRecord.uri')
                    .whereRef('ReplyRecord.authorId', '!=', 'Record.authorId')
                    .select(eb => eb.fn.count<number>('Post.uri').as('count')).as("replies_count")
            ])
            .execute()

        // TO DO: Hacer adentro de la query
        res = sortByKey(res, e => {
            return [
                e.created_at > startDate ? 1 : 0,
                (e.uniqueLikesCount ?? 0) +
                (e.uniqueRepostsCount ?? 0) +
                (Number(e.replies_count) ?? 0) -
                (e.autolike ? 1 : 0) -
                (e.autorepost ? 1 : 0),
                e.created_at.getTime()
            ];
        }, listOrderDesc);

        skeleton = res
            .map(e => ({ post: e.uri }))
            .slice(0, 25)
        nextCursor = undefined

    } else if(metric == "Popularidad relativa") {
        // Contamos cantidad de likes, reposts y respuestas. TO DO: contar citas
        let res = await ctx.kysely
            .selectFrom('Record')
            .where('Record.collection', 'in', collections)
            .innerJoin('Content', 'Record.uri', 'Content.uri')
            .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            .select(eb => [
                'Record.uri',
                'Record.uniqueLikesCount',
                'Record.uniqueRepostsCount',
                'Record.created_at',
                eb.exists(eb.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .whereRef("Reaction.subjectId", "=", "Record.uri")
                    .where('ReactionRecord.collection', '=', 'app.bsky.feed.like')
                    .whereRef('ReactionRecord.authorId', '=', 'Record.authorId')).as("autolike"),
                eb.exists(eb.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .whereRef("Reaction.subjectId", "=", "Record.uri")
                    .where('ReactionRecord.collection', '=', 'app.bsky.feed.repost')
                    .whereRef('ReactionRecord.authorId', '=', 'Record.authorId')).as("autorepost"),
                eb.selectFrom('Post')
                    .leftJoin('Record', 'Record.uri', 'Post.replyToId')
                    .innerJoin('Record as ReplyRecord', 'Post.uri', 'ReplyRecord.uri')
                    .whereRef('ReplyRecord.authorId', '!=', 'Record.authorId')
                    .select(eb => eb.fn.count<number>('Post.uri').as('count')).as("replies_count"),
                eb.selectFrom('Follow')
                    .whereRef("Follow.userFollowedId", "=", "Record.authorId")
                    .leftJoin('Record', 'Follow.uri', 'Record.uri' )
                    .leftJoin('User as Follower', 'Record.authorId', 'Follower.did')
                    .select((eb) => eb.fn.count<number>('Follower.did').distinct().as('followers_count'))
                    .where("Follower.inCA", "=", true).as("followers_count")
            ])
            .execute()

        res = sortByKey(res, e => {
            return [
                e.created_at > startDate ? 1 : 0,
                ((e.uniqueLikesCount ?? 0) +
                (e.uniqueRepostsCount ?? 0) +
                (Number(e.replies_count) ?? 0) -
                (e.autolike ? 1 : 0) -
                (e.autorepost ? 1 : 0)) /
                ((e.followers_count ?? 0) + 1) ** (1/2),
                e.created_at.getTime()
            ];
        }, listOrderDesc)

        skeleton = res
            .map(e => ({ post: e.uri }))
            .slice(0, 25)
        nextCursor = undefined
    }
    else {
        const res = (await ctx.kysely.selectFrom('Record')
            .where('Record.collection', 'in', collections)
            .innerJoin('Content', 'Record.uri', 'Content.uri')
            .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            .select(['Record.uri'])
            .orderBy('Record.created_at', 'desc')
            .execute()).slice(0, 25)
        skeleton = res.map(e => ({ post: e.uri }))
        nextCursor = undefined
    }

    const result = {
        skeleton, cursor: nextCursor
    }
    await ctx.ioredis.set(redisKey, JSON.stringify(result), "EX", 3600)
    return result
}


export const getEnDiscusionFeedPipeline = (
    metric: EnDiscusionMetric = "Me gustas", time: EnDiscusionTime = "Último día", format: FeedFormatOption = "Todos"): FeedPipelineProps => {
    return {
        getSkeleton: getEnDiscusionSkeleton(metric, time, format)
    }
}


export const addToEnDiscusion: CAHandler<{params: {collection: string, rkey: string}}, {}> = async (ctx, agent, {params} ) => {
    // TO DO: Pasar a processUpdate
    const {collection, rkey} = params
    const did = agent.did

    const res = await agent.bsky.com.atproto.repo.getRecord({
        repo: did,
        collection,
        rkey
    })

    if(!res.success){
        return {error: "No se pudo agregar a en discusión."}
    }

    const record = res.data.value

    const validatePost = validatePostRecord(record)
    const validateArticle = validateArticleRecord(record)

    let validRecord: $Typed<PostRecord> | $Typed<ArticleRecord> | undefined
    if(validatePost.success) {
        validRecord = {...validatePost.value, $type: "app.bsky.feed.post"}
    } else if(validateArticle.success){
        validRecord = {...validateArticle.value, $type: "ar.cabildoabierto.feed.article"}
    }

    if(validRecord) {
        if(validRecord.labels && isSelfLabels(validRecord.labels)){
            validRecord.labels.values.push({val: "ca:en discusión"})
        } else if(!validRecord.labels){
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

        if(isArticleRecord(validRecord)){
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


export const removeFromEnDiscusion: CAHandler<{params: {collection: string, rkey: string}}, {}> = async (ctx, agent, {params} ) => {
    // TO DO: Pasar a processUpdate
    const {collection, rkey} = params
    const did = agent.did

    const res = await agent.bsky.com.atproto.repo.getRecord({
        repo: did,
        collection,
        rkey
    })

    if(!res.success){
        return {error: "No se pudo remover de en discusión."}
    }

    const record = res.data.value

    const validatePost = validatePostRecord(record)
    const validateArticle = validateArticleRecord(record)

    let validRecord: PostRecord | ArticleRecord | undefined
    if(validatePost.success) {
        validRecord = validatePost.value
    } else if(validateArticle.success){
        validRecord = validateArticle.value
    }

    if(validRecord) {
        if(validRecord.labels && isSelfLabels(validRecord.labels)){
            validRecord.labels.values = validRecord.labels.values.filter(v => v.val != "ca:en discusión")
        }

        const ref = await agent.bsky.com.atproto.repo.putRecord({
            repo: did,
            collection,
            rkey,
            record: validRecord
        })

        if(isArticleRecord(record)){
            await processArticle(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord as ArticleRecord)
        } else if(isPostRecord(record)){
            await processPost(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord as PostRecord)
        }
    } else {
        return {error: "No se pudo remover de en discusión."}
    }

    await redisDeleteByPrefix(ctx, "endiscusion-skeleton")

    return {data: {}}
}