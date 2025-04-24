import {ThreadViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getCollectionFromUri, getUri} from "#/utils/uri";
import {FeedSkeleton} from "#/services/feed/feed";
import {
    fetchHydrationData,
    hydrateThreadViewContent,
    HydrationData, joinHydrationData, ThreadSkeleton
} from "#/services/hydration/hydrate";
import {unique} from "#/utils/arrays";
import {isThreadViewPost} from "#/lex-server/types/app/bsky/feed/defs";
import {CAHandler} from "#/utils/handler";


async function getThreadRepliesSkeletonForPost(ctx: AppContext, agent: SessionAgent, uri: string){
    const {data} = await agent.bsky.getPostThread({uri})

    const thread = isThreadViewPost(data.thread) ? data.thread : null

    const bskySkeleton = thread && thread.replies ? thread.replies
        .map(r => isThreadViewPost(r) ? {post: r.post.uri} : null)
        .filter(x => x != null) : []

    return unique(bskySkeleton, (x => x.post))
}


export async function getThreadRepliesSkeletonForArticle(ctx: AppContext, agent: SessionAgent, uri: string): Promise<FeedSkeleton> {
    return (await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            content: {
                post: {
                    replyToId: uri
                }
            }
        }
    })).map(x => ({post: x.uri}))
}


export async function getThreadRepliesSkeleton(ctx: AppContext, agent: SessionAgent, uri: string): Promise<FeedSkeleton> {
    const collection = getCollectionFromUri(uri)

    if(collection == "app.bsky.feed.post"){
        return await getThreadRepliesSkeletonForPost(ctx, agent, uri)
    } else if(collection == "ar.cabildoabierto.feed.article"){
        return await getThreadRepliesSkeletonForArticle(ctx, agent, uri)
    } else {
        throw Error("Replies skeleton not implemented for:" + collection)
    }
}


export async function getThreadHydrationData(ctx: AppContext, agent: SessionAgent, skeleton: ThreadSkeleton): Promise<HydrationData> {
    const [repliesData, mainContentData] = await Promise.all([
        skeleton.replies ? fetchHydrationData(ctx, agent, skeleton.replies) : {},
        fetchHydrationData(ctx, agent, [{post: skeleton.post}])
    ])

    return joinHydrationData(repliesData, mainContentData)
}


export const getThread: CAHandler<{params: {did: string, collection: string, rkey: string}}, ThreadViewContent> = async (ctx, agent, {params})  => {
    const {did, collection, rkey} = params
    const uri = getUri(did, collection, rkey)
    const replies = await getThreadRepliesSkeleton(ctx, agent, uri)
    const skeleton: ThreadSkeleton = {post: uri, replies}
    const data = await getThreadHydrationData(ctx, agent, skeleton)

    const thread = hydrateThreadViewContent({post: uri, replies}, data, true)

    return thread ? {data: thread} : {error: "Ocurrió un error al obtener el contenido."}
}

