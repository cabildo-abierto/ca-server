import {FeedSkeleton, GetSkeletonProps} from "#/services/feed/feed";
import {concat} from "#/utils/arrays";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getSkeletonFromTimeline} from "#/services/feed/inicio/following";
import {Dataplane} from "#/services/hydration/dataplane";


export async function getMainProfileFeedSkeletonBsky(agent: SessionAgent, did: string, data: Dataplane): Promise<FeedSkeleton> {
    const res = await agent.bsky.getAuthorFeed({actor: did, filter: "posts_and_author_threads"})
    const feed = res.data.feed
    data.storeFeedViewPosts(feed)

    return getSkeletonFromTimeline(feed)
}


export async function getMainProfileFeedSkeletonCA(ctx: AppContext, did: string, data: Dataplane): Promise<FeedSkeleton> {
    return (await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            authorId: did,
            collection: {
                in: ["ar.cabildoabierto.feed.article", "ar.com.cabildoabierto.article"]
            }
        }
    })).map(({uri}) => ({post: uri}))
}


export const getMainProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent, data) => {
        return concat(await Promise.all([
            getMainProfileFeedSkeletonBsky(agent, did, data),
            getMainProfileFeedSkeletonCA(ctx, did, data)
        ]))
    }
}
