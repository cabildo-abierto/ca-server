import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getUri} from "#/utils/uri";

type GetLikesType = CAHandler<{params: {did: string, rkey: string, collection: string}, query: {limit?: string, cursor?: string}}, {profiles: ProfileViewBasic[], cursor?: string}>

async function getLikesSkeleton(ctx: AppContext, agent: SessionAgent, uri: string, limit: number, cursor: string | undefined): Promise<{
    uris: string[];
    cursor?: string;
}>
{
    const likesSkeletonResponse = await agent.bsky.getLikes({uri, limit, cursor: cursor})

    // Devolver cursor al frontend para volver a llamar la función y cargar más likes
    console.log(likesSkeletonResponse.data.cursor)
    return {uris: likesSkeletonResponse.success ? likesSkeletonResponse.data.likes.map((value) => value.actor.did) : [],
            cursor: likesSkeletonResponse.data.cursor}
}


export const getLikes: GetLikesType = async (ctx, agent, {params, query}) =>  {
    const {did, collection, rkey} = params
    const uri = getUri(did, collection, rkey)
    const {uris, cursor} = await getLikesSkeleton(ctx, agent, uri, parseInt(query.limit ?? "25"), query.cursor)
    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchUsersHydrationData(uris)

    const data = {profiles: uris.map(d => hydrateProfileViewBasic(d, dataplane)).filter(x => x != null),
                  cursor : cursor
    }
    console.log("Length de la data: ", data.profiles.length)
    return {data}
}


export const getReposts: CAHandler<{params: {limit: number, offset: number, did: string, rkey: string, collection: string}}, ProfileViewBasic[]> = async (ctx, agent, {params}) =>  {

    return {data: []}
}