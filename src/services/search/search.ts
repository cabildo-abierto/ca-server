import {CAHandler} from "#/utils/handler";
import {HydrationData} from "#/services/hydration/hydrate";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {getCADataForUsers} from "#/services/user/users";


export const searchUsers: CAHandler<{
    params: { query: string }
}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    const {query} = params
    const {data} = await agent.bsky.searchActorsTypeahead({q: query})

    let caUsers: CAProfileViewBasic[] = await ctx.db.$queryRaw`
        SELECT *
        FROM "User"
        WHERE "User"."displayName" ILIKE '%' || ${query} || '%'
           OR "User"."handle" ILIKE '%' || ${query} || '%'
    `;

    caUsers = [...caUsers, ...await getCADataForUsers(ctx, data.actors.map(a => a.did))]

    const hData: HydrationData = {
        bskyUsers: new Map<string, ProfileViewBasic>(data.actors.map(a => [a.did, a])),
        caUsers: new Map<string, CAProfileViewBasic>(caUsers.map(a => [a.did, a]))
    }

    const userList = unique([
        ...caUsers.map(u => u.did),
        ...data.actors.map(u => u.did)
    ])

    const users = userList.map(did => hydrateProfileViewBasic(did, hData))

    return {data: users.filter(x => x != null)}
}