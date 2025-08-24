import {FeedPipelineProps, FeedSortKey, GetSkeletonProps} from "#/services/feed/feed";
import {CAHandler} from "#/utils/handler";
import {Record as PostRecord, validateRecord as validatePostRecord, isRecord as isPostRecord} from "#/lex-api/types/app/bsky/feed/post";
import {Record as ArticleRecord, validateRecord as validateArticleRecord, isRecord as isArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {processArticle, processPost} from "#/services/sync/process-event";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {$Typed} from "@atproto/api";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {sql} from "kysely";
import {logTimes} from "#/utils/utils";


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
    const label = 'ca:en discusión'

    if(metric == "Me gustas"){

        let skeleton = await ctx.kysely
            .with("RecordsEnDiscusion", (db => db
                    .selectFrom("Record")
                    .select([
                        "Record.uri",
                        "Record.created_at",
                        "Record.uniqueLikesCount",
                        "Record.authorId"
                    ])
                    .where('Record.collection', 'in', collections)
                    .innerJoin('Content', 'Record.uri', 'Content.uri')
                    .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            ))
            .with('Autolikes', (db) =>
                db.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .leftJoin('RecordsEnDiscusion as SubjectRecord', 'Reaction.subjectId', 'SubjectRecord.uri')
                    .where('ReactionRecord.collection', 'in', [
                        'app.bsky.feed.like'
                    ])
                    .whereRef('ReactionRecord.authorId', '=', 'SubjectRecord.authorId')
                    .select(['Reaction.uri', 'Reaction.subjectId'])
            )
            .selectFrom('RecordsEnDiscusion as Record')
            .leftJoin('Autolikes', 'Record.uri', 'Autolikes.subjectId')
            .select([
                'Record.uri',
                'Record.uniqueLikesCount',
                'Record.created_at',
                'Autolikes.uri as autolikes_uri',
            ])
            .execute();

        skeleton = sortByKey(skeleton, e => {
            return [
                e.created_at > startDate ? 1 : 0,
                (e.uniqueLikesCount ?? 0) - (e.autolikes_uri ? 1 : 0),
                e.created_at.getTime()
            ];
        }, listOrderDesc);

        return {
            skeleton: skeleton.map(e => ({ post: e.uri })),
            cursor: undefined
        };

    } else if(metric == "Interacciones"){

        // Contamos cantidad de likes, reposts y respuestas. Pendiente: contar citas
        let skeleton = await ctx.kysely
            .with("RecordsEnDiscusion", (db => db
                .selectFrom("Record")
                .select([
                    "Record.uri",
                    "Record.created_at",
                    "Record.uniqueLikesCount",
                    "Record.uniqueRepostsCount",
                    "Record.authorId"
                ])
                .where('Record.collection', 'in', collections)
                .innerJoin('Content', 'Record.uri', 'Content.uri')
                .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            ))
            .with('Autolikes', (db) =>
                db.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .leftJoin('RecordsEnDiscusion as SubjectRecord', 'Reaction.subjectId', 'SubjectRecord.uri')
                    .where('ReactionRecord.collection', 'in', [
                        'app.bsky.feed.like'
                    ])
                    .whereRef('ReactionRecord.authorId', '=', 'SubjectRecord.authorId')
                    .select(['Reaction.uri', 'Reaction.subjectId'])
            )
            .with('Autoreposts', (db) =>
                db.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .leftJoin('RecordsEnDiscusion as SubjectRecord', 'Reaction.subjectId', 'SubjectRecord.uri')
                    .where('ReactionRecord.collection', 'in', [
                        'app.bsky.feed.repost',
                    ])
                    .whereRef('ReactionRecord.authorId', '=', 'SubjectRecord.authorId')
                    .select(['Reaction.uri', 'Reaction.subjectId'])
            )
            .with('RepliesFromOthers', (db) =>
                db.selectFrom('Record as RecordsEnDiscusion')
                    .leftJoin('Post', 'RecordsEnDiscusion.uri', 'Post.replyToId')
                    .innerJoin('Record as ReplyRecord', 'Post.uri', 'ReplyRecord.uri')
                    .whereRef('ReplyRecord.authorId', '!=', 'RecordsEnDiscusion.authorId')
                    .select(['RecordsEnDiscusion.uri as reply_to_uri',
                            (eb) => eb.fn.count<number>('Post.uri').as('reply_count')
                            ])
                    .groupBy(['RecordsEnDiscusion.uri'])
            )
            .selectFrom('RecordsEnDiscusion as Record')
            .leftJoin('Autolikes', 'Record.uri', 'Autolikes.subjectId')
            .leftJoin('Autoreposts', 'Record.uri', 'Autoreposts.subjectId')
            .leftJoin('RepliesFromOthers', 'Record.uri', 'RepliesFromOthers.reply_to_uri')
            .select([
                'Record.uri',
                'Record.uniqueLikesCount',
                'Record.uniqueRepostsCount',
                'Record.created_at',
                'Autolikes.uri as autolikes_uri',
                'Autoreposts.uri as autoreposts_uri',
                'RepliesFromOthers.reply_count as replies_from_others_count'
            ])
            .execute();

        skeleton = sortByKey(skeleton, e => {
            return [
                e.created_at > startDate ? 1 : 0,
                (e.uniqueLikesCount ?? 0) +
                (e.uniqueRepostsCount ?? 0) +
                (Number(e.replies_from_others_count) ?? 0) -
                (e.autolikes_uri ? 1 : 0) -
                (e.autoreposts_uri ? 1 : 0),
                e.created_at.getTime()
            ];
        }, listOrderDesc);

        return {
            skeleton: skeleton.map(e => ({ post: e.uri })),
            cursor: undefined
        };

    } else if(metric == "Popularidad relativa") {
        // Contamos cantidad de likes, reposts y respuestas. Pendiente: contar citas

        let skeleton = await ctx.kysely
            .with("RecordsEnDiscusion", (db => db
                    .selectFrom("Record")
                    .select([
                        "Record.uri",
                        "Record.created_at",
                        "Record.uniqueLikesCount",
                        "Record.uniqueRepostsCount",
                        "Record.authorId"
                    ])
                    .where('Record.collection', 'in', collections)
                    .innerJoin('Content', 'Record.uri', 'Content.uri')
                    .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            ))
            .with('Autolikes', (db) =>
                db.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .leftJoin('RecordsEnDiscusion as SubjectRecord', 'Reaction.subjectId', 'SubjectRecord.uri')
                    .where('ReactionRecord.collection', 'in', [
                        'app.bsky.feed.like'
                    ])
                    .whereRef('ReactionRecord.authorId', '=', 'SubjectRecord.authorId')
                    .select(['Reaction.uri', 'Reaction.subjectId'])
            )
            .with('Autoreposts', (db) =>
                db.selectFrom('Reaction')
                    .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                    .leftJoin('RecordsEnDiscusion as SubjectRecord', 'Reaction.subjectId', 'SubjectRecord.uri')
                    .where('ReactionRecord.collection', 'in', [
                        'app.bsky.feed.repost',
                    ])
                    .whereRef('ReactionRecord.authorId', '=', 'SubjectRecord.authorId')
                    .select(['Reaction.uri', 'Reaction.subjectId'])
            )
            .with('RepliesFromOthers', (db) =>
                db.selectFrom('Record as RecordsEnDiscusion')
                    .leftJoin('Post', 'RecordsEnDiscusion.uri', 'Post.replyToId')
                    .innerJoin('Record as ReplyRecord', 'Post.uri', 'ReplyRecord.uri')
                    .whereRef('ReplyRecord.authorId', '!=', 'RecordsEnDiscusion.authorId')
                    .select(['RecordsEnDiscusion.uri as reply_to_uri',
                        (eb) => eb.fn.count<number>('Post.uri').as('reply_count')
                    ])
                    .groupBy(['RecordsEnDiscusion.uri'])
            )
            .with('AuthorFollowers', (db) =>
                db.selectFrom('User')
                    .leftJoin('Follow', 'User.did', 'Follow.userFollowedId')
                    .leftJoin('Record', 'Follow.uri', 'Record.uri' )
                    .leftJoin('User as Follower', 'Record.authorId', 'Follower.did')
                    .select(['User.did',
                        (eb) => eb.fn.count<number>('Follower.did').distinct().as('followers_count')
                    ])
                    .where("User.inCA", "=", true)
                    .groupBy(['User.did'])
            )
            .selectFrom('RecordsEnDiscusion as Record')
            .leftJoin('Autolikes', 'Record.uri', 'Autolikes.subjectId')
            .leftJoin('Autoreposts', 'Record.uri', 'Autoreposts.subjectId')
            .leftJoin('RepliesFromOthers', 'Record.uri', 'RepliesFromOthers.reply_to_uri')
            .leftJoin('AuthorFollowers', 'Record.authorId', 'AuthorFollowers.did')
            .select([
                'Record.uri',
                'Record.uniqueLikesCount',
                'Record.uniqueRepostsCount',
                'Record.created_at',
                'Autolikes.uri as autolikes_uri',
                'Autoreposts.uri as autoreposts_uri',
                "AuthorFollowers.followers_count",
                'RepliesFromOthers.reply_count as replies_from_others_count'
            ])
            .execute();

            skeleton = sortByKey(skeleton, e => {
                return [
                    e.created_at > startDate ? 1 : 0,
                    ((e.uniqueLikesCount ?? 0) +
                    (e.uniqueRepostsCount ?? 0) +
                    (Number(e.replies_from_others_count) ?? 0) -
                    (e.autolikes_uri ? 1 : 0) -
                    (e.autoreposts_uri ? 1 : 0)) /
                    ((e.followers_count ?? 0) + 1) ** (1/2),
                    e.created_at.getTime()
                ];
            }, listOrderDesc);

            return {
                skeleton: skeleton.map(e => ({ post: e.uri })),
                cursor: undefined
            };
    }
    else {
        const skeleton = await ctx.kysely.selectFrom('Record')
            .where('Record.collection', 'in', collections)
            .innerJoin('Content', 'Record.uri', 'Content.uri')
            .where(sql<boolean>`"Content"."selfLabels" @> ARRAY[${label}]::text[]`)
            .select(['Record.uri'])
            .orderBy('Record.created_at', 'desc')
            .execute()
        return {
            skeleton: skeleton.map(e => ({ post: e.uri })),
            cursor: undefined
        }
    }
}


const enDiscusionSortKey = (metric: EnDiscusionMetric): FeedSortKey => {
    return null
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