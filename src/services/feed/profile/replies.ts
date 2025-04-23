import {FeedSkeleton, GetSkeletonProps} from "#/services/feed/feed";
import {concat} from "#/utils/arrays";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getSkeletonFromTimeline} from "#/services/feed/inicio/following";


export async function getRepliesProfileFeedSkeletonBsky(agent: SessionAgent, did: string): Promise<FeedSkeleton> {
    const feed = await agent.bsky.getAuthorFeed({actor: did, filter: "posts_with_replies"})

    return getSkeletonFromTimeline(feed.data.feed, false)
}


export async function getRepliesProfileFeedSkeletonCA(ctx: AppContext, did: string): Promise<FeedSkeleton> {
    return (await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            authorId: did,
            collection: "ar.com.cabildoabierto.article"
        }
    })).map(({uri}) => ({post: uri}))

    // TO DO: respuestas y quote posts a artículos
}


export const getRepliesProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent) => {
        return concat(await Promise.all([
            getRepliesProfileFeedSkeletonBsky(agent, did),
            getRepliesProfileFeedSkeletonCA(ctx, did)
        ]))
    }
}