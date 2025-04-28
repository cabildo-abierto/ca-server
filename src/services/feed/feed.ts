import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {followingFeedPipeline} from "#/services/feed/inicio/following";
import {SessionAgent} from "#/utils/session-agent";
import {hydrateFeed} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {logTimes} from "#/utils/utils";
import {AppContext} from "#/index";
import {enDiscusionFeedPipeline} from "#/services/feed/inicio/discusion";
import {discoverFeedPipeline} from "#/services/feed/inicio/discover";
import {SkeletonFeedPost} from "#/lex-server/types/app/bsky/feed/defs";
import {CAHandler, CAHandlerOutput} from "#/utils/handler";


export const getFeedByKind: CAHandler<{params: {kind: string}}, FeedViewContent[]> = async (ctx, agent, {params}) => {
    let pipeline: FeedPipelineProps
    const {kind} = params
    if(kind == "discusion"){
        pipeline = enDiscusionFeedPipeline
    } else if(kind == "siguiendo"){
        pipeline = followingFeedPipeline
    } else if(kind == "descubrir"){
        pipeline = discoverFeedPipeline
    } else {
        return {error: "Invalid feed kind:" + kind}
    }
    return getFeed({ctx, agent, pipeline})
}


export type FeedSkeleton = SkeletonFeedPost[]


export type GetSkeletonProps = (ctx: AppContext, agent: SessionAgent) => Promise<FeedSkeleton>


export type FeedPipelineProps = {
    getSkeleton: GetSkeletonProps
    sortKey: (a: FeedViewContent) => number[]
}


export type GetFeedProps = {
    pipeline: FeedPipelineProps
    agent: SessionAgent
    ctx: AppContext
}


export const getFeed = async ({ctx, agent, pipeline}: GetFeedProps): CAHandlerOutput<FeedViewContent[]> => {

    const t1 = Date.now()
    const skeleton = await pipeline.getSkeleton(ctx, agent)

    const t2 = Date.now()
    let feed = await hydrateFeed(ctx, agent, skeleton)
    feed = sortByKey(feed, pipeline.sortKey, listOrderDesc)

    const t3 = Date.now()

    // logTimes("get feed", [t1, t2, t3])
    return {data: feed}
}