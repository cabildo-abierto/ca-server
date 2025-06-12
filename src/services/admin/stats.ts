import {CAHandler} from "#/utils/handler";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {ProfileViewBasic as ProfileViewBasicCA} from "#/lex-api/types/ar/cabildoabierto/actor/defs"

export type StatsDashboard = {
    lastUsers: ProfileViewBasicCA[]
}

export const getStatsDashboard: CAHandler<{}, StatsDashboard> = async (ctx, agent, {}) => {

    const users = await ctx.db.user.findMany({
        select: {
            did: true,
            createdAt: true
        },
        orderBy: {
            createdAt: "desc"
        },
        where: {
            inCA: true
        },
        take: 10
    })

    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchUsersHydrationData(users.map(u => u.did))

    const profiles: ProfileViewBasicCA[] = users.map(u => hydrateProfileViewBasic(u.did, dataplane)).filter(u => u != null)

    return {data: {lastUsers: profiles.map(p => ({...p, createdAt: users.find(u => u.did == p.did)?.createdAt.toString()}))}}
}