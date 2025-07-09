import {ThreadViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getCollectionFromUri, getUri, isArticle, isPost} from "#/utils/uri";
import {FeedSkeleton} from "#/services/feed/feed";
import {
    hydrateThreadViewContent,
    ThreadSkeleton
} from "#/services/hydration/hydrate";
import {unique} from "#/utils/arrays";
import {isThreadViewPost} from "#/lex-server/types/app/bsky/feed/defs";
import {CAHandler} from "#/utils/handler";
import {handleToDid} from "#/services/user/users";
import {Dataplane} from "#/services/hydration/dataplane";


async function getThreadRepliesSkeletonForPostFromBsky(ctx: AppContext, agent: SessionAgent, uri: string){
    try {
        const {data} = await agent.bsky.getPostThread({uri})
        const thread = isThreadViewPost(data.thread) ? data.thread : null

        const bskySkeleton = thread && thread.replies ? thread.replies
            .map(r => isThreadViewPost(r) ? {post: r.post.uri} : null)
            .filter(x => x != null) : []

        return unique(bskySkeleton, (x => x.post))
    } catch {
        return []
    }
}


export async function getThreadRepliesSkeletonForPostFromCA(ctx: AppContext, agent: SessionAgent, uri: string){
    // necesario en principio solo porque getPostThread de Bsky no funciona con posts que tienen selection quote
    return (await ctx.db.post.findMany({
        select: {
            uri: true
        },
        where: {
            replyToId: uri
        },
        take: 20
    })).map(x => ({post: x.uri}))
}


async function getThreadRepliesSkeletonForPost(ctx: AppContext, agent: SessionAgent, uri: string){
    const [repliesBsky, repliesCA] = await Promise.all([
        getThreadRepliesSkeletonForPostFromBsky(ctx, agent, uri),
        getThreadRepliesSkeletonForPostFromCA(ctx, agent, uri)
    ])

    return unique([...repliesBsky, ...repliesCA], (x => x.post))
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

    if(isPost(collection)){
        return await getThreadRepliesSkeletonForPost(ctx, agent, uri)
    } else if(isArticle(collection)){
        return await getThreadRepliesSkeletonForArticle(ctx, agent, uri)
    } else {
        throw Error("Replies skeleton not implemented for:" + collection)
    }
}


export const getThread: CAHandler<{params: {handleOrDid: string, collection: string, rkey: string}}, ThreadViewContent> = async (ctx, agent, {params})  => {
    const {handleOrDid, collection, rkey} = params
    const did = await handleToDid(ctx, agent, handleOrDid)
    if(!did) {
        return {error: "No se encontró el autor."}
    }

    const uri = getUri(did, collection, rkey)
    const replies = await getThreadRepliesSkeleton(ctx, agent, uri)
    const skeleton: ThreadSkeleton = {post: uri, replies}

    const data = new Dataplane(ctx, agent)
    await data.fetchThreadHydrationData(skeleton)

    const thread = hydrateThreadViewContent({post: uri, replies}, data, true)

    return thread ? {data: thread} : {error: "Ocurrió un error al obtener el contenido."}
}

