import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {followingFeedPipeline} from "#/services/feed/inicio/following";
import {SessionAgent} from "#/utils/session-agent";
import {hydrateFeed} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {AppContext} from "#/index";
import {enDiscusionFeedPipeline} from "#/services/feed/inicio/discusion";
import {discoverFeedPipeline} from "#/services/feed/inicio/discover";
import {SkeletonFeedPost} from "#/lex-server/types/app/bsky/feed/defs";
import {CAHandler, CAHandlerOutput} from "#/utils/handler";
import {Dataplane} from "#/services/hydration/dataplane";


export const getFeedByKind: CAHandler<{params: {kind: string}, query: {cursor?: string}}, GetFeedOutput> = async (ctx, agent, {params, query}) => {
    let pipeline: FeedPipelineProps
    const {kind} = params
    const {cursor} = query
    if(kind == "discusion"){
        pipeline = enDiscusionFeedPipeline
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


export type FeedPipelineProps = {
    getSkeleton: GetSkeletonProps
    sortKey?: (a: FeedViewContent) => number[]
    filter?: (feed: FeedViewContent[]) => FeedViewContent[]
}


export type GetFeedProps = {
    pipeline: FeedPipelineProps
    agent: SessionAgent
    ctx: AppContext
    cursor?: string
}

export type GetFeedOutput = {
    feed: FeedViewContent[]
    cursor?: string
}

export const getFeed = async ({ctx, agent, pipeline, cursor}: GetFeedProps): CAHandlerOutput<GetFeedOutput> => {
    const t1 = Date.now()

    const data = new Dataplane(ctx, agent)
    const {skeleton, cursor: newCursor} = await pipeline.getSkeleton(ctx, agent, data, cursor)
    const t2 = Date.now()

    let feed: FeedViewContent[] = await hydrateFeed(skeleton, data)
    const t3 = Date.now()

    if(pipeline.sortKey){
        feed = sortByKey(feed, pipeline.sortKey, listOrderDesc)
    }

    if(pipeline.filter){
        feed = pipeline.filter(feed)
    }
    // logTimes("get feed", [t1, t2, t3])
    return {data: {feed, cursor: newCursor}}
}