import {CAHandler} from "#/utils/handler";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {ProfileViewBasic as ProfileViewBasicCA} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {getUsersWithReadSessions} from "#/services/monetization/user-months";
import {isWeeklyActiveUser} from "#/services/monetization/donations";
import {count, listOrderDesc, sortByKey} from "#/utils/arrays";
import {sql} from "kysely";


export type StatsDashboard = {
    lastUsers: (ProfileViewBasicCA & { lastReadSession: Date | null, CAProfileCreatedAt?: Date })[]
    counts: {
        registered: number
        active: number
        verified: number
        verifiedActive: number
    }
    WAUPlot: { date: Date, count: number }[]
    usersPlot: { date: Date, count: number }[]
    WAUPlotVerified: { date: Date, count: number }[]
    articlesPlot: {date: Date, count: number}[]
    topicVersionsPlot: {date: Date, count: number}[]
    caCommentsPlot: {date: Date, count: number}[]
}


export const testUsers = [
    "usuariodepruebas.bsky.social",
    "usuariodepruebas2.bsky.social",
    "usuariodepruebas3.bsky.social",
    "usuariodepruebas4.bsky.social",
    "usuariodepruebas5.bsky.social",
    "carlitos-tester.bsky.social",
    "pruebaprueba.bsky.social"
]


async function getRegisteredUsers(ctx: AppContext, agent: SessionAgent): Promise<StatsDashboard["lastUsers"]> {
    const users = await ctx.db.user.findMany({
        select: {
            did: true,
            createdAt: true,
            userValidationHash: true,
            orgValidation: true,
            readSessions: {
                select: {
                    createdAt: true
                },
                orderBy: {
                    createdAt: "desc"
                }
            },
            CAProfile: {
                select: {
                    createdAt: true
                }
            }
        },
        where: {
            inCA: true,
            hasAccess: true,
            handle: {
                notIn: testUsers
            }
        }
    })

    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchUsersHydrationData(users.map(u => u.did))

    const profiles: ProfileViewBasicCA[] = users.map(u => hydrateProfileViewBasic(u.did, dataplane)).filter(u => u != null)
    return sortByKey(profiles.map(p => {
        const user = users.find(u => u.did == p.did)
        if (user) {
            return {
                ...p,
                CAProfileCreatedAt: user.CAProfile?.createdAt,
                lastReadSession: user.readSessions.length > 0 ? user?.readSessions[0].createdAt : null,
                createdAt: user.createdAt.toString(),
            }
        }
        return null
    }).filter(u => u != null), e => {
        return e?.lastReadSession ? [e.lastReadSession.getTime()] : [0]
    }, listOrderDesc)
}


function dailyPlotData<T>(data: T[], condition: (x: T, d: Date) => boolean): {date: Date, count: number}[] {
    const startDate = new Date(2025, 5, 15) // new Date(2025, 6, 8)
    const oneDay = 1000 * 3600 * 24
    const endDate = new Date(Date.now() + oneDay)
    const res: { date: Date, count: number }[] = []
    for (let d = new Date(startDate); d < endDate; d = new Date(d.getTime() + oneDay)) {
        const c = count(data, u => condition(u, d))
        res.push({date: d, count: c})
    }
    return res
}


async function getWAUPlot(ctx: AppContext, verified: boolean) {
    const after = new Date(0)
    const users = await getUsersWithReadSessions(ctx, after, verified)
    const data = dailyPlotData(
        users,
        (u, d) => isWeeklyActiveUser(u, d)
    )
    return {
        WAUPlot: data,
        active: data[data.length-1].count
    }
}


async function getTopicVersionsPlot(ctx: AppContext) {
    const tv = await ctx.db.record.findMany({
        select: {
            createdAt: true
        },
        where: {
            collection: "ar.cabildoabierto.wiki.topicVersion",
            authorId: {
                notIn: [
                    "cabildoabierto.ar"
                ]
            }
        }
    })

    return dailyPlotData(
        tv,
        (x, d) => x.createdAt.toDateString() == d.toDateString()
    )
}


async function getArticlesPlot(ctx: AppContext) {
    const tv = await ctx.db.record.findMany({
        select: {
            createdAt: true
        },
        where: {
            collection: "ar.cabildoabierto.feed.article"
        }
    })

    return dailyPlotData(
        tv,
        (x, d) => x.createdAt.toDateString() == d.toDateString()
    )
}


async function getCACommentsPlot(ctx: AppContext) {
    const tv = await ctx.db.record.findMany({
        select: {
            createdAt: true
        },
        where: {
            content: {
                post: {
                    root: {
                        collection: {
                            in: ["ar.cabildoabierto.feed.article", "ar.cabildoabierto.wiki.topicVersion"]
                        }
                    }
                }
            },
            collection: "app.bsky.feed.post"
        }
    })

    return dailyPlotData(
        tv,
        (x, d) => x.createdAt.toDateString() == d.toDateString()
    )
}


async function getUsersPlot(ctx: AppContext, users: StatsDashboard["lastUsers"]){
    return dailyPlotData(
        users,
        (x, d) => x.CAProfileCreatedAt != null && new Date(x.CAProfileCreatedAt) <= getEndOfDay(d)
    )
}


function getEndOfDay(date: Date) {
    const endOfDay = new Date(date); // clone the date
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
}


export const getStatsDashboard: CAHandler<{}, StatsDashboard> = async (ctx, agent, {}) => {
    const lastUsers = await getRegisteredUsers(ctx, agent)

    const {WAUPlot, active} = await getWAUPlot(ctx, false)
    const {WAUPlot: WAUPlotVerified, active: verifiedActive} = await getWAUPlot(ctx, true)

    const topicVersionsPlot = await getTopicVersionsPlot(ctx)
    const caCommentsPlot = await getCACommentsPlot(ctx)
    const articlesPlot = await getArticlesPlot(ctx)
    const usersPlot = await getUsersPlot(ctx, lastUsers)

    return {
        data: {
            lastUsers,
            WAUPlot,
            usersPlot,
            WAUPlotVerified,
            counts: {
                active,
                verified: count(lastUsers, u => u.verification != null),
                verifiedActive,
                registered: lastUsers.length
            },
            topicVersionsPlot,
            caCommentsPlot,
            articlesPlot,
        }
    }
}


export type ActivityStats = {
    did: string
    handle: string
    articles: number
    topicVersions: number
    enDiscusion: number
}


export const getActivityStats: CAHandler<{}, ActivityStats[]> = async (ctx, agent, {}) => {

    const results = await ctx.kysely
        .selectFrom('User')
        .leftJoin('Record', 'Record.authorId', 'User.did')
        .innerJoin("Content", "Content.uri", "Record.uri")
        .leftJoin("PaymentPromise", "PaymentPromise.contentId", "Record.uri")
        .select([
            'User.did',
            'User.handle',
            ctx.kysely.fn
                .count<number>(sql`case when "Record".collection = 'app.bsky.feed.post' and 'ca:en discusión' = ANY("Content"."selfLabels") then 1 end`)
                .as('enDiscusion'),
            ctx.kysely.fn
                .count<number>(sql`case when "Record".collection = 'ar.cabildoabierto.feed.article' then 1 end`)
                .as('articles'),
            ctx.kysely.fn
                .count<number>(sql`case when "Record".collection = 'ar.cabildoabierto.wiki.topicVersion' then 1 end`)
                .as('topicVersions'),
            ctx.kysely.fn
                .sum<number>("PaymentPromise.amount")
                .as('income')
        ])
        .where('User.inCA', '=', true)
        .groupBy(['User.did', 'User.handle'])
        .execute()

    const stats: ActivityStats[] = []

    results.forEach(s => {
        if(s.handle){
            stats.push({
                ...s,
                handle: s.handle
            })
        }
    })

    return {data: stats}
}

