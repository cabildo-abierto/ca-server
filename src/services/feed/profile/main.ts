import {GetSkeletonOutput, GetSkeletonProps} from "#/services/feed/feed";
import {AppContext} from "#/setup";
import {Agent} from "#/utils/session-agent";
import {getSkeletonFromTimeline} from "#/services/feed/inicio/following";
import {Dataplane} from "#/services/hydration/dataplane";
import {concat} from "#/utils/arrays";
import {SkeletonFeedPost} from "#/lex-api/types/app/bsky/feed/defs";


const getMainProfileFeedSkeletonBsky = async (ctx: AppContext, agent: Agent, data: Dataplane, did: string, cursor?: string): Promise<GetSkeletonOutput> => {
    if(!agent.hasSession()) return {skeleton: [], cursor: undefined}
    const res = await agent.bsky.app.bsky.feed.getAuthorFeed({actor: did, filter: "posts_and_author_threads", cursor})
    const feed = res.data.feed
    data.storeFeedViewPosts(feed)

    return {
        skeleton: getSkeletonFromTimeline(ctx, feed),
        cursor: res.data.cursor
    }
}


export const getMainProfileFeedSkeletonCA = async (ctx: AppContext, did: string, cursor?: string): Promise<(SkeletonFeedPost & {createdAt: Date})[]> => {
    const sk = await ctx.kysely
        .selectFrom("Record")
        .select(["uri", "created_at"])
        .where("authorId", "=", did)
        .where("collection", "in", ["ar.cabildoabierto.feed.article", "ar.com.cabildoabierto.article"])
        .$if(cursor != null, qb => qb.where("created_at", ">", new Date(cursor!)))
        .execute()

    return sk
        .map(({uri, created_at}) => ({post: uri, createdAt: created_at}))
}


export const getMainProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent, data, cursor) => {

        let [bskySkeleton, CASkeleton] = await Promise.all([
            getMainProfileFeedSkeletonBsky(ctx, agent, data, did, cursor),
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
