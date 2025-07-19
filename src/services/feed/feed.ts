import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {getFollowingFeedPipeline} from "#/services/feed/inicio/following";
import {Agent} from "#/utils/session-agent";
import {hydrateFeed} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {AppContext} from "#/index";
import {
    EnDiscusionMetric,
    EnDiscusionTime,
    FeedFormatOption,
    getEnDiscusionFeedPipeline
} from "#/services/feed/inicio/discusion";
import {discoverFeedPipeline} from "#/services/feed/inicio/discover";
import {CAHandler, CAHandlerOutput} from "#/utils/handler";
import {Dataplane} from "#/services/hydration/dataplane";
import {articlesFeedPipeline} from "#/services/feed/inicio/articles";
import {SkeletonFeedPost} from "@atproto/api/dist/client/types/app/bsky/feed/defs";


export type FollowingFeedFilter = "Todos" | "Solo Cabildo Abierto"


export const getFeedByKind: CAHandler<{params: {kind: string}, query: {cursor?: string, metric?: EnDiscusionMetric, time?: EnDiscusionTime, format?: FeedFormatOption, filter?: FollowingFeedFilter}}, GetFeedOutput> = async (ctx, agent, {params, query}) => {
    let pipeline: FeedPipelineProps
    const {kind} = params
    const {cursor, metric, time, filter, format} = query
    if(kind == "discusion"){
        pipeline = getEnDiscusionFeedPipeline(metric, time, format)
    } else if(kind == "siguiendo"){
        pipeline = getFollowingFeedPipeline(filter, format)
    } else if(kind == "descubrir") {
        pipeline = discoverFeedPipeline
    } else if(kind == "articulos") {
        pipeline = articlesFeedPipeline
    } else {
        return {error: "Invalid feed kind:" + kind}
    }
    return getFeed({ctx, agent, pipeline, cursor})
}


export type FeedSkeleton = SkeletonFeedPost[]


export type GetSkeletonOutput = {skeleton: FeedSkeleton, cursor: string | undefined}
export type GetSkeletonProps = (ctx: AppContext, agent: Agent, data: Dataplane, cursor?: string) => Promise<GetSkeletonOutput>
export type FeedSortKey = ((a: FeedViewContent) => number[]) | null

export type FeedPipelineProps = {
    getSkeleton: GetSkeletonProps
    sortKey?: FeedSortKey
    filter?: (feed: FeedViewContent[]) => FeedViewContent[]
}


export type GetFeedProps = {
    pipeline: FeedPipelineProps
    agent: Agent
    ctx: AppContext
    cursor?: string
    params?: {metric?: string, time?: string}
}

export type GetFeedOutput = {
    feed: FeedViewContent[]
    cursor?: string
}

export const getFeed = async ({ctx, agent, pipeline, cursor}: GetFeedProps): CAHandlerOutput<GetFeedOutput> => {
    const data = new Dataplane(ctx, agent)

    let newCursor: string | undefined
    let skeleton: FeedSkeleton
    try {
        const res = await pipeline.getSkeleton(ctx, agent, data, cursor)
        newCursor = res.cursor
        skeleton = res.skeleton
    } catch (err) {
        console.log("Error getting feed skeleton", err)
        if(err instanceof Error){
            console.log("name", err.name)
            console.log("message", err.message)
        }
        return {error: "Ocurrió un error al obtener el muro."}
    }

    let feed: FeedViewContent[] = await hydrateFeed(skeleton, data)

    if(pipeline.sortKey){
        feed = sortByKey(feed, pipeline.sortKey, listOrderDesc)
    }

    if(pipeline.filter){
        feed = pipeline.filter(feed)
    }
    return {data: {feed, cursor: newCursor}}
}