import {FeedPipelineProps, GetSkeletonProps} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";
import {CAHandler} from "#/utils/handler";
import {Record as PostRecord, validateRecord as validatePostRecord, isRecord as isPostRecord} from "#/lex-api/types/app/bsky/feed/post";
import {Record as ArticleRecord, validateRecord as validateArticleRecord, isRecord as isArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {processArticle, processPost} from "#/services/sync/process-event";
import {isSelfLabels} from "@atproto/api/dist/client/types/com/atproto/label/defs";
import {$Typed} from "@atproto/api";



export const getEnDiscusionSkeleton: GetSkeletonProps = async (ctx, agent, data, cursor) => {
    const skeleton = await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            content: {
                selfLabels: {
                    has: "ca:en discusión"
                }
            }
        }
    }).then(x => x.map(r => ({post: r.uri})))

    return {skeleton, cursor}
}


export const enDiscusionFeedPipeline: FeedPipelineProps = {
    getSkeleton: getEnDiscusionSkeleton,
    sortKey: rootCreationDateSortKey
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
            const su = await processArticle(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord)
            await su.apply()
        } else {
            const su = await processPost(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord)
            await su.apply()
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
            const su = await processArticle(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord as ArticleRecord)
            await su.apply()
        } else if(isPostRecord(record)){
            const su = await processPost(ctx, {uri: ref.data.uri, cid: ref.data.cid}, validRecord as PostRecord)
            await su.apply()
        }
    } else {
        return {error: "No se pudo remover de en discusión."}
    }


    return {data: {}}
}