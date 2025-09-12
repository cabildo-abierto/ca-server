import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getUri} from "#/utils/uri";
import {hydratePostView} from "#/services/hydration/hydrate";
import {PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs";

type GetInteractionsType = CAHandler<{params: {did: string, rkey: string, collection: string}, query: {limit?: string, cursor?: string}}, {profiles: ProfileViewBasic[], cursor?: string}>
type GetQuotesType = CAHandler<{params: {did: string, rkey: string, collection: string}, query: {limit?: string, cursor?: string}}, {posts: PostView[], cursor?: string}>

async function getLikesSkeleton(ctx: AppContext, agent: SessionAgent, uri: string, dataplane: Dataplane, limit: number, cursor: string | undefined): Promise<{
    dids: string[];
    cursor?: string;
}>
{
    const likesSkeletonResponse = await agent.bsky.getLikes({uri, limit, cursor: cursor})
    for (const user of likesSkeletonResponse.data.likes) {
        dataplane.bskyUsers.set(user.actor.did, {...user.actor, $type: "app.bsky.actor.defs#profileView"})
    }

    return {dids: likesSkeletonResponse.success ? likesSkeletonResponse.data.likes.map((value) => value.actor.did) : [],
            cursor: likesSkeletonResponse.data.cursor}
}

async function getRepostsSkeleton(ctx: AppContext, agent: SessionAgent, uri: string, dataplane: Dataplane, limit: number, cursor: string | undefined): Promise<{
    dids: string[];
    cursor?: string;
}>
{
    const repostsSkeletonResponse = await agent.bsky.getRepostedBy({uri, limit, cursor: cursor})
    for (const user of repostsSkeletonResponse.data.repostedBy) {
        dataplane.bskyUsers.set(user.did, {...user, $type: "app.bsky.actor.defs#profileView"})
    }

    return {dids: repostsSkeletonResponse.success ? repostsSkeletonResponse.data.repostedBy.map((value) => value.did) : [],
        cursor: repostsSkeletonResponse.data.cursor}
}

async function getQuotesSkeleton(ctx: AppContext, agent: SessionAgent, uri: string, dataplane: Dataplane, limit: number, cursor: string | undefined): Promise<{
    uris: string[];
    cursor?: string;
}>
{
    const quotesSkeletonResponse = await agent.bsky.app.bsky.feed.getQuotes({uri, limit, cursor: cursor})
    for (const post of quotesSkeletonResponse.data.posts) {
        dataplane.bskyPosts.set(post.uri, post)
    }

    return {uris: quotesSkeletonResponse.success ? quotesSkeletonResponse.data.posts.map((value) => value.uri) : [],
        cursor: quotesSkeletonResponse.data.cursor}
}


export const getLikes: GetInteractionsType = async (ctx, agent, {params, query}) =>  {
    const {did, collection, rkey} = params
    const uri = getUri(did, collection, rkey)
    const dataplane = new Dataplane(ctx, agent)
    const {dids, cursor} = await getLikesSkeleton(ctx, agent, uri, dataplane, parseInt(query.limit ?? "25"), query.cursor)
    await dataplane.fetchUsersHydrationData(dids)

    const data = {profiles: dids.map(d => hydrateProfileViewBasic(d, dataplane)).filter(x => x != null),
                  cursor : cursor
    }
    return {data}
}

export const getReposts: GetInteractionsType = async (ctx, agent, {params, query}) =>  {
    const {did, collection, rkey} = params
    const uri = getUri(did, collection, rkey)
    const dataplane = new Dataplane(ctx, agent)
    const {dids, cursor} = await getRepostsSkeleton(ctx, agent, uri, dataplane, parseInt(query.limit ?? "25"), query.cursor)
    await dataplane.fetchUsersHydrationData(dids)

    const data = {profiles: dids.map(d => hydrateProfileViewBasic(d, dataplane)).filter(x => x != null),
        cursor : cursor
    }
    return {data}
}

export const getQuotes: GetQuotesType = async (ctx, agent, {params, query}) =>  {
    const {did, collection, rkey} = params
    const uri = getUri(did, collection, rkey)
    const dataplane = new Dataplane(ctx, agent)
    const {uris, cursor} = await getQuotesSkeleton(ctx, agent, uri, dataplane, parseInt(query.limit ?? "25"), query.cursor)
    await dataplane.fetchPostAndArticleViewsHydrationData(uris)

    console.log("CA quotes", dataplane.caContents.size)
    console.log("bsky quotes", dataplane.bskyPosts.size)

    const data = {posts: uris.map(d => hydratePostView(d, dataplane).data).filter(x => x != null),
        cursor : cursor
    }
    return {data}
}