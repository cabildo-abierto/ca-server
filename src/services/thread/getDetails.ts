import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getUri} from "#/utils/uri";


async function getLikesSkeleton(ctx: AppContext, agent: SessionAgent, uri: string, limit: number, offset: number = 0): Promise<string[]> {

    const likesSkeleton = await agent.bsky.getLikes({uri, limit})

    // Devolver cursor al frontend para volver a llamar la función y cargar más likes
    console.log(likesSkeleton.data.cursor)
    return likesSkeleton.success ? likesSkeleton.data.likes.map((value) => value.actor.did) : []
}


export const getLikes: CAHandler<{params: {limit: number, offset: number, did: string, rkey: string, collection: string}}, ProfileViewBasic[]> = async (ctx, agent, {params}) =>  {
    const {did, collection, rkey} = params
    const uri = getUri(did, collection, rkey)
    const dids = await getLikesSkeleton(ctx, agent, uri, params.limit, params.offset)
    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchUsersHydrationData(dids)

    const data = dids
        .map(d => hydrateProfileViewBasic(d, dataplane))
        .filter(x => x != null)

    return {data}
}

export const getReposts: CAHandler<{params: {limit: number, offset: number, did: string, rkey: string, collection: string}}, ProfileViewBasic[]> = async (ctx, agent, {params}) =>  {

    return {data: []}
}