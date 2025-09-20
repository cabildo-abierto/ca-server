import {GetSkeletonOutput, GetSkeletonProps} from "#/services/feed/feed";
import {AppContext} from "#/setup";
import {Agent} from "#/utils/session-agent";
import {getSkeletonFromTimeline} from "#/services/feed/inicio/following";
import {Dataplane} from "#/services/hydration/dataplane";
import {concat} from "#/utils/arrays";
import {SkeletonFeedPost} from "#/lex-api/types/app/bsky/feed/defs";


const getMainProfileFeedSkeletonBsky = async (agent: Agent, data: Dataplane, did: string, cursor?: string): Promise<GetSkeletonOutput> => {
    if(!agent.hasSession()) return {skeleton: [], cursor: undefined}
    const res = await agent.bsky.app.bsky.feed.getAuthorFeed({actor: did, filter: "posts_and_author_threads", cursor})
    const feed = res.data.feed
    data.storeFeedViewPosts(feed)

    return {
        skeleton: getSkeletonFromTimeline(feed),
        cursor: res.data.cursor
    }
}


export const getMainProfileFeedSkeletonCA = async (ctx: AppContext, did: string, cursor?: string): Promise<(SkeletonFeedPost & {createdAt: Date})[]> => {
    return (await ctx.db.record.findMany({
        select: {
            uri: true,
            createdAt: true
        },
        where: {
            authorId: did,
            collection: {
                in: ["ar.cabildoabierto.feed.article", "ar.com.cabildoabierto.article"]
            },
            createdAt: cursor ? {
                lte: new Date(cursor)
            } : undefined
        }
    })).map(({uri, createdAt}) => ({post: uri, createdAt}))
}


export const getMainProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent, data, cursor) => {

        let [bskySkeleton, CASkeleton] = await Promise.all([
            getMainProfileFeedSkeletonBsky(agent, data, did, cursor),
            getMainProfileFeedSkeletonCA(ctx, did, cursor)
        ])

        if(bskySkeleton.cursor != undefined){
            const newCursorDate = new Date(bskySkeleton.cursor)
            CASkeleton = CASkeleton.filter(x => new Date(x.createdAt) >= newCursorDate)
        }

        const skeleton = concat([bskySkeleton.skeleton, CASkeleton])

        return {
            skeleton,
            cursor: bskySkeleton.skeleton.length > 0 ? bskySkeleton.cursor : undefined
        }
    }
}
