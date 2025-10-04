import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {getFollowingFeedPipeline} from "#/services/feed/inicio/following";
import {Agent} from "#/utils/session-agent";
import {hydrateFeed} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {AppContext} from "#/setup";
import {
    EnDiscusionMetric,
    EnDiscusionTime,
    FeedFormatOption,
    getEnDiscusionFeedPipeline
} from "#/services/feed/inicio/discusion";
import {discoverFeedPipeline} from "#/services/feed/inicio/discover";
import {CAHandlerNoAuth, CAHandlerOutput} from "#/utils/handler";
import {Dataplane} from "#/services/hydration/dataplane";
import {articlesFeedPipeline} from "#/services/feed/inicio/articles";
import {SkeletonFeedPost} from "@atproto/api/dist/client/types/app/bsky/feed/defs";
import {clearFollowsHandler, getProfile, getSessionData} from "#/services/user/users";


export type FollowingFeedFilter = "Todos" | "Solo Cabildo Abierto"


async function maybeClearFollows(ctx: AppContext, agent: Agent) {
    if(agent.hasSession()){
        const data = await getSessionData(ctx, agent.did)
        ctx.logger.pino.info({data}, "checking clear follows")
        if(data && (!data.seenTutorial || !data.seenTutorial.home)){
            const {data: profile} = await getProfile(ctx, agent, {params: {handleOrDid: agent.did}})

            ctx.logger.pino.info({data, profile}, "checking clear follows")
            if(profile && profile.bskyFollowsCount == 1){
                await clearFollowsHandler(ctx, agent, {})
            }
        }
    }
}


export const getFeedByKind: CAHandlerNoAuth<{params: {kind: string}, query: {cursor?: string, metric?: EnDiscusionMetric, time?: EnDiscusionTime, format?: FeedFormatOption, filter?: FollowingFeedFilter}}, GetFeedOutput> = async (ctx, agent, {params, query}) => {
    let pipeline: FeedPipelineProps
    
    const {kind} = params
    const {cursor, metric, time, filter, format} = query
    if(kind == "discusion"){
        pipeline = getEnDiscusionFeedPipeline(metric, time, format)
    } else if(kind == "siguiendo"){
        await maybeClearFollows(ctx, agent)
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
    filter?: (ctx: AppContext, feed: FeedViewContent[]) => FeedViewContent[]
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

    const t1 = Date.now()
    let newCursor: string | undefined
    let skeleton: FeedSkeleton
    try {
        const t1 = Date.now()
        const res = await pipeline.getSkeleton(ctx, agent, data, cursor)

        const t2 = Date.now()
        ctx.logger.logTimes("feed skeleton", [t1, t2])
        newCursor = res.cursor
        skeleton = res.skeleton
    } catch (err) {
        console.error("Error getting feed skeleton", err)
        if(err instanceof Error){
            console.error("name", err.name)
            console.error("message", err.message)
        }
        return {error: "Ocurrió un error al obtener el muro."}
    }
    const t2 = Date.now()

    let feed: FeedViewContent[] = await hydrateFeed(ctx, skeleton, data)
    const t3 = Date.now()

    if(pipeline.sortKey){
        feed = sortByKey(feed, pipeline.sortKey, listOrderDesc)
    }

    if(pipeline.filter){
        feed = pipeline.filter(ctx, feed)
    }
    const t4 = Date.now()

    ctx.logger.logTimes("get feed", [t1, t2, t3, t4])
    return {data: {feed, cursor: newCursor}}
}