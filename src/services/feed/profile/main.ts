import {FeedSkeleton, GetSkeletonProps} from "#/services/feed/feed";
import {concat} from "#/utils/arrays";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getSkeletonFromTimeline} from "#/services/feed/inicio/following";


export async function getMainProfileFeedSkeletonBsky(agent: SessionAgent, did: string): Promise<FeedSkeleton> {
    const feed = await agent.bsky.getAuthorFeed({actor: did, filter: "posts_and_author_threads"})

    return getSkeletonFromTimeline(feed.data.feed, false)
}


export async function getMainProfileFeedSkeletonCA(ctx: AppContext, did: string): Promise<FeedSkeleton> {
    return (await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            authorId: did,
            collection: "ar.cabildoabierto.feed.article"
        }
    })).map(({uri}) => ({post: uri}))
}


export const getMainProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent) => {
        return concat(await Promise.all([
            getMainProfileFeedSkeletonBsky(agent, did),
            getMainProfileFeedSkeletonCA(ctx, did)
        ]))
    }
}
