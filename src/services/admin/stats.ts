import {CAHandler} from "#/utils/handler";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {ProfileViewBasic as ProfileViewBasicCA} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getUsersWithReadSessions} from "#/services/monetization/user-months";
import {isWeeklyActiveUser} from "#/services/monetization/donations";
import {count} from "#/utils/arrays";

export type StatsDashboard = {
    lastUsers: ProfileViewBasicCA[]
    WAUPlot: {date: Date, count: number}[]
}


async function lastUsersRegistered(ctx: AppContext, agent: SessionAgent) {
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
        take: 50
    })

    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchUsersHydrationData(users.map(u => u.did))

    const profiles: ProfileViewBasicCA[] = users.map(u => hydrateProfileViewBasic(u.did, dataplane)).filter(u => u != null)
    return profiles.map(p => ({...p, createdAt: users.find(u => u.did == p.did)?.createdAt.toString()}))
}


async function getWAUPlot(ctx: AppContext) {
    const after = new Date(0)
    const users = await getUsersWithReadSessions(ctx, after)
    const startDate = new Date(2025, 5, 15) // new Date(2025, 6, 8)
    const endDate = new Date()
    const oneDay = 1000*3600*24
    const data: {date: Date, count: number}[] = []
    for(let d = new Date(startDate); d < endDate; d = new Date(d.getTime()+oneDay)){
        const c = count(users, u => isWeeklyActiveUser(u, d))
        data.push({date: d, count: c})
    }
    return data
}


export const getStatsDashboard: CAHandler<{}, StatsDashboard> = async (ctx, agent, {}) => {
    const lastUsers = await lastUsersRegistered(ctx, agent)

    const WAUPlot = await getWAUPlot(ctx)
    console.log("returning wau plot", WAUPlot)

    return {data: {lastUsers, WAUPlot}}
}


