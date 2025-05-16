import {GetSkeletonOutput, GetSkeletonProps} from "#/services/feed/feed";
import {concat} from "#/utils/arrays";
import {SessionAgent} from "#/utils/session-agent";
import {getSkeletonFromTimeline} from "#/services/feed/inicio/following";
import {Dataplane} from "#/services/hydration/dataplane";
import {getMainProfileFeedSkeletonCA} from "#/services/feed/profile/main";


const getRepliesProfileFeedSkeletonBsky = async (agent: SessionAgent, data: Dataplane, did: string, cursor?: string): Promise<GetSkeletonOutput> => {
    const res = await agent.bsky.getAuthorFeed({actor: did, filter: "posts_with_replies", cursor})
    const feed = res.data.feed
    data.storeFeedViewPosts(feed)

    return {
        skeleton: getSkeletonFromTimeline(feed),
        cursor: res.data.cursor
    }
}


export const getRepliesProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent, data, cursor) => {

        let [bskySkeleton, CASkeleton] = await Promise.all([
            getRepliesProfileFeedSkeletonBsky(agent, data, did, cursor),
            getMainProfileFeedSkeletonCA(ctx, did, cursor)
        ])

        if(bskySkeleton.cursor != undefined){
            const newCursorDate = new Date(bskySkeleton.cursor)
            CASkeleton = CASkeleton.filter(x => new Date(x.createdAt) <= newCursorDate)
        }
        return {
            skeleton: concat([bskySkeleton.skeleton, CASkeleton]),
            cursor: bskySkeleton.skeleton.length > 0 ? bskySkeleton.cursor : undefined
        }
    }
}
