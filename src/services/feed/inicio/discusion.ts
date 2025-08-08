import {FeedPipelineProps, FeedSortKey, GetSkeletonProps} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";
import {CAHandler} from "#/utils/handler";
import {Record as PostRecord, validateRecord as validatePostRecord, isRecord as isPostRecord} from "#/lex-api/types/app/bsky/feed/post";
import {Record as ArticleRecord, validateRecord as validateArticleRecord, isRecord as isArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {processArticle, processPost} from "#/services/sync/process-event";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {$Typed} from "@atproto/api";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {sql} from "kysely";


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
    const startDate = getEnDiscusionStartDate(time)
    // Me gustas: usamos uniqueLikesCount - autolikes.
    // Interacciones: usamos uniqueLikesCount + uniqueRepliesCount + uniqueRepostsCount
    // Popularidad relativa: usamos Interacciones / Cantidad de seguidores del autor en Bsky

    const collections = format == "Artículos" ? ["ar.cabildoabierto.feed.article"] : ["ar.cabildoabierto.feed.article", "app.bsky.feed.post"]

    if(metric == "Me gustas"){
        const label = 'ca:en discusión'

        let skeleton = await ctx.kysely.with('Autolikes', (db) =>
            db.selectFrom('Reaction')
                .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                .leftJoin('Record as SubjectRecord', 'Reaction.subjectId', 'SubjectRecord.uri')
                .where('ReactionRecord.collection', '=', 'app.bsky.feed.like')
                .where('ReactionRecord.authorId', '=', 'SubjectRecord.authorId')
                .select(['Reaction.uri', 'Reaction.subjectId'])
            )
            .selectFrom('Record')
            .leftJoin('Autolikes', 'Record.uri', 'Autolikes.subjectId')
            .where('Record.collection', 'in', collections)
            .innerJoin('Content', 'Record.uri', 'Content.uri')
            .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            .select([
                'Record.uri',
                'Record.uniqueLikesCount',
                'Record.created_at',
                'Autolikes.uri as autolikes_uri',
            ])
            .execute();

        console.log("--------------------------------------------------------------------------------------------------")
        console.log("En discusión skeleton", skeleton.filter(e => e.autolikes_uri != null))

        skeleton = sortByKey(skeleton, e => {
            return [
                e.created_at > startDate ? 1 : 0,
                e.uniqueLikesCount ?? 0 - (e.autolikes_uri ? 1:0),
                e.created_at.getTime()
            ];
        }, listOrderDesc);

        //console.log("getEnDiscusionSkeleton OUTPUT", { metric, time, format, skeleton });

        return {
            skeleton: skeleton.map(e => ({ post: e.uri })),
            cursor: undefined
        };
    } else if(metric == "Interacciones"){
        let skeleton = await ctx.db.record.findMany({
            select: {
                uri: true,
                uniqueLikesCount: true,
                uniqueRepostsCount: true,
                _count: {
                    select: {
                        replies: true
                    }
                },
                createdAt: true
            },
            where: {
                content: {
                    selfLabels: {
                        has: "ca:en discusión"
                    }
                },
                collection: {
                    in: collections
                }
            }
        })
        skeleton = sortByKey(skeleton, e => {
            return [
                e.createdAt > startDate ? 1 : 0,
                (e.uniqueLikesCount ?? 0) + (e.uniqueRepostsCount ?? 0) + e._count.replies,
                e.createdAt.getTime()
            ]
        }, listOrderDesc)
        return {
            skeleton: skeleton
                .map(e => ({post: e.uri})),
            cursor: undefined
        }
    } else if(metric == "Popularidad relativa") {
        let skeleton = await ctx.db.record.findMany({
            select: {
                uri: true,
                uniqueLikesCount: true,
                uniqueRepostsCount: true,
                _count: {
                    select: {
                        replies: true
                    }
                },
                author: {
                    select: {
                        _count: {
                            select: {
                                followers: true
                            }
                        }
                    }
                },
                createdAt: true
            },
            where: {
                content: {
                    selfLabels: {
                        has: "ca:en discusión"
                    }
                },
                collection: {
                    in: collections
                }
            }
        })
        skeleton = sortByKey(skeleton, e => {
            return [
                e.createdAt > startDate ? 1 : 0,
                ((e.uniqueLikesCount ?? 0) + (e.uniqueRepostsCount ?? 0) + e._count.replies) / (e.author._count.followers + 1),
                e.createdAt.getTime()
            ]
        }, listOrderDesc)
        return {
            skeleton: skeleton
                .map(e => ({post: e.uri})),
            cursor: undefined
        }
    }
    return {
        skeleton: [],
        cursor: undefined
    }
}


const enDiscusionSortKey = (metric: EnDiscusionMetric): FeedSortKey => {
    if(metric == "Recientes"){
        return rootCreationDateSortKey
    } else {
        return null
    }
}


export const getEnDiscusionFeedPipeline = (
    metric: EnDiscusionMetric = "Me gustas", time: EnDiscusionTime = "Último día", format: FeedFormatOption = "Todos"): FeedPipelineProps => {
    return {
        getSkeleton: getEnDiscusionSkeleton(metric, time, format),
        sortKey: enDiscusionSortKey(metric),
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


    return {data: {}}
}