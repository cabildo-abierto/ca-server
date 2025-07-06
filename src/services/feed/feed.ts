import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {followingFeedPipeline} from "#/services/feed/inicio/following";
import {SessionAgent} from "#/utils/session-agent";
import {hydrateFeed} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {AppContext} from "#/index";
import {EnDiscusionMetric, EnDiscusionTime, getEnDiscusionFeedPipeline} from "#/services/feed/inicio/discusion";
import {discoverFeedPipeline} from "#/services/feed/inicio/discover";
import {SkeletonFeedPost} from "#/lex-server/types/app/bsky/feed/defs";
import {CAHandler, CAHandlerOutput} from "#/utils/handler";
import {Dataplane} from "#/services/hydration/dataplane";


export const getFeedByKind: CAHandler<{params: {kind: string}, query: {cursor?: string, metric?: EnDiscusionMetric, time?: EnDiscusionTime}}, GetFeedOutput> = async (ctx, agent, {params, query}) => {
    let pipeline: FeedPipelineProps
    const {kind} = params
    const {cursor, metric, time} = query
    if(kind == "discusion"){
        pipeline = getEnDiscusionFeedPipeline(metric, time)
    } else if(kind == "siguiendo"){
        pipeline = followingFeedPipeline
    } else if(kind == "descubrir"){
        pipeline = discoverFeedPipeline
    } else {
        return {error: "Invalid feed kind:" + kind}
    }
    return getFeed({ctx, agent, pipeline, cursor})
}


export type FeedSkeleton = SkeletonFeedPost[]


export type GetSkeletonOutput = {skeleton: FeedSkeleton, cursor: string | undefined}
export type GetSkeletonProps = (ctx: AppContext, agent: SessionAgent, data: Dataplane, cursor?: string) => Promise<GetSkeletonOutput>
export type FeedSortKey = ((a: FeedViewContent) => number[]) | null

export type FeedPipelineProps = {
    getSkeleton: GetSkeletonProps
    sortKey?: FeedSortKey
    filter?: (feed: FeedViewContent[]) => FeedViewContent[]
}


export type GetFeedProps = {
    pipeline: FeedPipelineProps
    agent: SessionAgent
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
    const {skeleton, cursor: newCursor} = await pipeline.getSkeleton(ctx, agent, data, cursor)

    let feed: FeedViewContent[] = await hydrateFeed(skeleton, data)

    if(pipeline.sortKey){
        feed = sortByKey(feed, pipeline.sortKey, listOrderDesc)
    }

    if(pipeline.filter){
        feed = pipeline.filter(feed)
    }
    return {data: {feed, cursor: newCursor}}
}