import {AppContext} from "#/index";
import {ProfileView, ProfileViewDetailed} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {Prisma} from "@prisma/client";
import {Account, MentionProps, Profile, Session, UserStats} from "#/lib/types";
import { SessionAgent } from "#/utils/session-agent";
import {getDidFromUri, getRkeyFromUri } from "#/utils/uri";
import {deleteRecords} from "#/services/admin";
import {cleanText} from "#/utils/strings";
import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {HydrationData} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";


export async function getFollowing(ctx: AppContext, did: string): Promise<string[]> {
    const follows = await ctx.db.record.findMany({
        select: {
            follow: {
                select: {
                    userFollowedId: true
                }
            }
        },
        where: {
            collection: "app.bsky.graph.follow",
            authorId: did
        }
    })
    return follows.filter(f => f.follow).map((f) => (f.follow ? f.follow.userFollowedId : null)).filter(s => s != null)
}


export async function handleToDid(agent: SessionAgent, userId: string){
    if(userId.startsWith("did")) {
        return userId
    } else {
        const {data} = await agent.bsky.resolveHandle({handle: userId})
        return data.did
    }
}


export async function isCAUser(ctx: AppContext, did: string) {
    const res = await ctx.db.user.findFirst({
        select: {did: true},
        where: {
            did,
            inCA: true
        }
    })
    return res != null
}


export const getUsers = async (ctx: AppContext): Promise<{ users?: CAProfileViewBasic[], error?: string }> => {
    try {
        const res = await ctx.db.user.findMany({
            select: {
                did: true,
                handle: true,
                displayName: true,
                avatar: true,
                description: true,
                CAProfileUri: true
            },
            where: {
                inCA: true
            }
        })

        let users: CAProfileViewBasic[] = []

        res.forEach(u => {
            if(u.handle){
                users.push({
                    ...u,
                    handle: u.handle,
                    displayName: u.displayName ?? undefined,
                    avatar: u.avatar ?? undefined,
                    caProfile: u.CAProfileUri ?? undefined
                })
            }
        })

        return {users}
    } catch (error) {
        return {error: "Error al obtener a los usuarios."}
    }
}


export const getConversations = async (ctx: AppContext, userId: string) => {
    const user = await ctx.db.user.findUnique(
        {
            select: {
                did: true,
                messagesSent: {
                    select: {
                        id: true,
                        createdAt: true,
                        fromUserId: true,
                        toUserId: true,
                        text: true,
                        seen: true
                    },
                },
                messagesReceived: {
                    select: {
                        id: true,
                        createdAt: true,
                        fromUserId: true,
                        toUserId: true,
                        text: true,
                        seen: true
                    }
                }
            },
            where: {
                did: userId
            }
        }
    )
    if (!user) return []

    let users = new Map<string, { date: Date, seen: boolean }>()

    function addMessage(from: string, date: Date, seen: boolean) {
        const y = users.get(from)
        if (y) {
            if (y.date.getTime() < date.getTime()) {
                users.set(from, {date: date, seen: seen})
            }
        } else {
            users.set(from, {date: date, seen: seen})
        }
    }

    user.messagesReceived.forEach((m) => {
        addMessage(m.fromUserId, m.createdAt, m.seen)
    })

    user.messagesSent.forEach((m) => {
        addMessage(m.toUserId, m.createdAt, m.seen)
    })

    return Array.from(users).map(([u, d]) => ({id: u, date: d.date, seen: d.seen}))
}


export async function getATProtoUserById(agent: SessionAgent, userId: string): Promise<{ profile?: ProfileViewDetailed, error?: string }> {
    try {
        const {data} = await agent.bsky.getProfile({
            actor: userId
        })
        return {profile: data}
    } catch {
        return {error: "Error getting ATProto user"}
    }
}


const fullUserQuery = {
    did: true,
    handle: true,
    avatar: true,
    banner: true,
    displayName: true,
    description: true,
    email: true,
    createdAt: true,
    hasAccess: true,
    inCA: true,
    platformAdmin: true,
    editorStatus: true,
    seenTutorial: true,
    usedInviteCode: {
        select: {
            code: true
        }
    },
    subscriptionsUsed: {
        orderBy: {
            createdAt: "asc" as Prisma.SortOrder
        }
    },
    subscriptionsBought: {
        select: {
            id: true,
            price: true
        },
        where: {
            price: {
                gte: 500
            }
        }
    },
    records: {
        select: {
            cid: true,
            follow: {
                select: {
                    userFollowedId: true
                }
            }
        },
        where: {
            collection: "app.bsky.graph.follow",
            follow: {
                userFollowed: {
                    inCA: true
                }
            }
        }
    },
    followers: {
        select: {
            uri: true,
            record: {
                select: {
                    authorId: true
                }
            }
        }
    },
    messagesReceived: {
        select: {
            createdAt: true,
            id: true,
            text: true,
            fromUserId: true,
            toUserId: true,
            seen: true
        }
    },
    messagesSent: {
        select: {
            createdAt: true,
            id: true,
            text: true,
            fromUserId: true,
            toUserId: true,
            seen: true
        }
    }
}


// TO DO: Eliminar esta función, está repetida
export function createRecord({ctx, uri, cid, createdAt, collection}: {
    ctx: AppContext
    uri: string
    cid: string
    createdAt: Date
    collection: string
}){
    // @ts-ignore
    const data = {
        uri,
        cid,
        rkey: getRkeyFromUri(uri),
        createdAt: new Date(createdAt),
        authorId: getDidFromUri(uri),
        collection: collection
    }

    let updates: any[] = [ctx.db.record.upsert({
        create: data,
        update: data,
        where: {
            uri: uri
        }
    })]
    return updates
}



export async function createFollowDB({ctx, did, uri, cid, followedDid}: {ctx: AppContext, did: string, uri: string, cid: string, followedDid: string}) {
    const updates= [
        ...createRecord({ctx, uri, cid, createdAt: new Date(), collection: "app.bsky.graph.follow"}),
        ctx.db.follow.create({
            data: {
                uri: uri,
                userFollowedId: followedDid
            }
        })
    ]

    await ctx.db.$transaction(updates)

    //await revalidateTags(["user:"+followedDid, "user:"+did])
}


export const follow: CAHandler<{followedDid: string}, {followUri: string}> = async (ctx, agent,  {followedDid}) => {
    try {
        const res = await agent.bsky.follow(followedDid)
        await createFollowDB({ctx, did: agent.did, ...res, followedDid})
        return {data: {followUri: res.uri}}
    } catch {
        return {error: "Error al seguir al usuario."}
    }
}


export const unfollow: CAHandler<{followUri: string}> = async (ctx, agent, {followUri}) => {
    try {
        await deleteRecords({ctx, agent, uris: [followUri], atproto: true})
        return {data: {}}
    } catch (err) {
        console.error(err)
        return {error: "Error al dejar de seguir al usuario."}
    }
}


export const getProfile: CAHandler<{params: {handleOrDid: string}}, Profile> = async (ctx, agent, {params}) => {
    const did = await handleToDid(agent, params.handleOrDid)

    try {
        const [bskyProfile, caProfile, caFollowsCount, caFollowersCount] = await Promise.all([
            agent.bsky.getProfile({actor: did}),
            ctx.db.user.findUnique({
                select: {
                    inCA: true,
                    editorStatus: true
                },
                where: {did}
            }),
            ctx.db.follow.count({
                where: {
                    record: {
                        authorId: did
                    },
                    userFollowed: {
                        inCA: true
                    }
                }
            }),
            ctx.db.follow.count({
                where: {
                    userFollowedId: did
                }
            })
        ])

        return {
            data: {
                bsky: bskyProfile.data,
                ca: caProfile ? {
                    ...caProfile,
                    inCA: caProfile.inCA,
                    followsCount: caFollowsCount,
                    followersCount: caFollowersCount
                } : null
            }
        }
    } catch (err) {
        return {error: "No se encontró el usuario."}
    }
}


export const getSession: CAHandler<{}, Session> = async (ctx, agent) => {
    const data = await ctx.db.user.findUnique({
        select: {
            platformAdmin: true,
            editorStatus: true,
            seenTutorial: true,
            handle: true,
            displayName: true,
            avatar: true,
            hasAccess: true
        },
        where: {
            did: agent.did
        }
    })
    if(!data || !data.handle) return {error: "No se encontró el usuario."}
    return {
        data: {
            ...data,
            did: agent.did,
            handle: data.handle
        }
    }
}


export const getAccount: CAHandler<{}, Account> = async (ctx, agent) => {
    const data = await ctx.db.user.findUnique({
        select: {
            email: true
        },
        where: {
            did: agent.did
        }
    })
    if(!data) return {error: "No se encontró el usuario."}
    return {
        data: {
            email: data.email ?? undefined
        }
    }
}


/*export async function buySubscriptions(userId: string, donatedAmount: number, paymentId: string) {
    const did = await getSessionDidNoRevalidate()
    if (!did || did != userId) return {error: "Error de autenticación"}

    const queries: {
        boughtByUserId: string,
        price: number,
        paymentId: string,
        isDonation: boolean,
        userId: string | null,
        usedAt: Date | null,
        endsAt: Date | null
    }[] = []

    const price = await getSubscriptionPrice()

    for (let i = 0; i < donatedAmount / price.price; i++) {
        queries.push({
            boughtByUserId: userId,
            price: price.price,
            paymentId: paymentId,
            isDonation: true,
            userId: null,
            usedAt: null,
            endsAt: null
        })
    }

    try {
        await ctx.db.subscription.createMany({
            data: queries
        })
    } catch (e) {
        return {error: "error on buy subscriptions"}
    }

    revalidateTag("user:" + userId)
    revalidateTag("poolsize")
    revalidateTag("fundingPercentage")
    return {}
}*/

/*export const getChatBetween = async (userId: string, anotherUserId: string) => {
    return unstable_cache(async () => {
        return db.chatMessage.findMany({
            select: {
                createdAt: true,
                id: true,
                text: true,
                fromUserId: true,
                toUserId: true,
                seen: true
            },
            where: {
                OR: [{
                    fromUserId: userId,
                    toUserId: anotherUserId
                },
                    {
                        fromUserId: anotherUserId,
                        toUserId: userId
                    }
                ]
            },
            orderBy: {
                createdAt: "asc"
            }
        });
    }, ["chat", userId, anotherUserId], {
        revalidate: revalidateEverythingTime,
        tags: [
            "chats",
            "chat:" + userId + ":" + anotherUserId
        ]
    })()
}*/


/*export async function sendMessage(message: string, userFrom: string, userTo: string) {
    try {
        await ctx.db.chatMessage.create({
            data: {
                text: message,
                fromUserId: userFrom,
                toUserId: userTo
            }
        })
    } catch {
        return {error: "Ocurrió un error al enviar el mensaje."}
    }
    revalidateTag("chat:" + userFrom + ":" + userTo)
    revalidateTag("chat:" + userTo + ":" + userFrom)
    revalidateTag("conversations:" + userFrom)
    revalidateTag("conversations:" + userTo)
    revalidateTag("not-responded-count")
    return {}
}*/


/*export async function setMessageSeen(id: string, userFrom: string, userTo: string) {
    await ctx.db.chatMessage.update({
        data: {
            seen: true
        },
        where: {
            id: id
        }
    })

    revalidateTag("chat:" + userFrom + ":" + userTo)
    revalidateTag("chat:" + userTo + ":" + userFrom)
    revalidateTag("conversations:" + userFrom)
    revalidateTag("conversations:" + userTo)
}*/


/*export const getSupportNotRespondedCount = async (ctx: AppContext, agent: SessionAgent) => {
    const user = await getUser(ctx, agent)
    if (!user || user.editorStatus != "Administrator") {
        return {error: "Sin permisos suficientes."}
    }

    const messages = await ctx.db.chatMessage.findMany(
        {
            select: {
                id: true,
                fromUserId: true,
                toUserId: true
            },
            where: {
                OR: [{toUserId: supportDid}, {fromUserId: supportDid}]
            },
            orderBy: {
                createdAt: "asc"
            }
        }
    )
    const c = new Set()

    for (let i = 0; i < messages.length; i++) {
        const m = messages[i]
        if (m.fromUserId == supportDid) {
            c.delete(m.toUserId)
        } else {
            c.add(m.fromUserId)
        }
    }

    return {count: c.size}
}*/


/*export async function addDonatedSubscriptionsManually(boughtByUserId: string, amount: number, price: number, paymentId?: string){

    const data = []
    for(let i = 0; i < amount; i++){
        data.push({
            boughtByUserId: boughtByUserId,
            price: price,
            paymentId: paymentId,
            isDonation: true
        })
    }

    await ctx.db.subscription.createMany({
        data: data
    })

}


export async function desassignSubscriptions(){
    await ctx.db.subscription.updateMany({
        data: {
            usedAt: null,
            endsAt: null,
            userId: null
        }
    })
}


export async function removeSubscriptions(){
    await ctx.db.subscription.deleteMany({
        where: {
            price: {
                lt: 499
            }
        }
    })
}*/


/*export async function createNewCAUserForBskyAccount(did: string, agent: Agent){
    try {
        const exists = await ctx.db.user.findFirst({
            where: {did: did}
        })
        if(!exists){

            const {data}: {data: ProfileViewDetailed} = await agent.getProfile({actor: agent.assertDid})

            await ctx.db.user.create({
                data: {
                    did: did,
                    handle: data.handle
                }
            })
        }
    } catch(err) {
        console.log("error", err)
        return {error: "Error al crear el usuario"}
    }
    return {}
}*/


export async function setATProtoProfile(ctx: AppContext, agent: SessionAgent, did: string) {

    try {
        const rec = {
            repo: did,
            collection: 'ar.com.cabildoabierto.profile',
            rkey: "self",
            record: {
                createdAt: new Date().toISOString(),
            },
        }

        await Promise.all([
            agent.bsky.com.atproto.repo.putRecord(rec),
            ctx.db.user.upsert({
                create: {
                    did: did,
                    inCA: true
                },
                update: {
                    inCA: true
                },
                where: {
                    did: did
                }
            })
        ])

        // revalidateTag("user:" + did)
        return {}
    } catch (err) {
        console.error("Error", err)
        return {error: "Error al conectar con ATProto."}
    }
}


/*export const getFundingPercentage = unstable_cache(async () => {
        const available = await ctx.db.subscription.findMany({
            select: {id: true},
            where: {
                usedAt: null,
                price: {
                    gte: 500
                }
            }
        })
        if (available.length > 0) {
            return 100
        }

        const usersWithViews = await ctx.db.user.findMany({
            select: {
                did: true,
                subscriptionsUsed: {
                    select: {
                        endsAt: true
                    },
                    orderBy: {
                        endsAt: "asc"
                    }
                },
                views: {
                    select: {
                        createdAt: true
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                }
            },
        })

        let activeUsers = 0
        let activeNoSubscription = 0
        usersWithViews.forEach((u) => {
            if (u.views.length > 0 && new Date().getTime() - u.views[0].createdAt.getTime() < 1000 * 3600 * 24 * 30) {
                activeUsers++
                if (!validSubscription(u)) {
                    activeNoSubscription++
                }
            }
        })

        return (1 - (activeNoSubscription / activeUsers)) * 100

    },
    ["fundingPercentage"],
    {
        revalidate: 5,
        tags: ["fundingPercentage"]
    }
)*/


/*export const getDonationsDistribution = unstable_cache(async () => {
        const users = await ctx.db.user.findMany({
            select: {
                subscriptionsBought: {
                    select: {
                        price: true
                    }
                },
                createdAt: true
            }
        })

        const today = new Date()
        let data: number[] = []
        users.forEach((u) => {
            let t = 0
            u.subscriptionsBought.forEach(({price}) => {
                t += price
            })
            const months = Math.ceil((today.getTime() - u.createdAt.getTime()) / (1000 * 3600 * 24 * 30))
            data.push(t / months)
        })
        data.sort((a, b) => {
            return Math.sign(a - b)
        })
        //console.log("data", data)

        const percentiles = data.map((value, index) => {
            return {value, p: index / data.length}
        })

        const inverse = []
        let j = 0
        for (let i = 0; i < 100; i++) {
            while (percentiles[j].p < i / 100 && j < percentiles.length - 1) j++
            inverse.push(percentiles[j].value)
        }

        return inverse
    },
    ["donationsDistribution"],
    {
        revalidate: 5,
        tags: ["donationsDistribution"]
    }
)*/


export async function searchATProtoUsers(agent: SessionAgent, q: string): Promise<{ users?: ProfileView[], error?: string }> {
    try {
        const {data} = await agent.bsky.searchActors({
            q
        })
        return {users: data.actors}
    } catch (error) {
        console.error(error)
        return {error: "Ocurrió un error en la búsqueda de usuarios de Bluesky."}
    }
}


export async function getUserStats(): Promise<{ stats?: UserStats, error?: string }> {
    const stats = {
        posts: 0,
        entityEdits: 0,
        editedEntities: 0,
        reactionsInPosts: 0,
        reactionsInEntities: 0,
        income: 0,
        pendingConfirmationIncome: 0,
        pendingPayIncome: 0,
        entityAddedChars: 0,
        viewsInPosts: 0,
        viewsInEntities: 0
    }
    return {stats}
}


export const queryMentions = async (ctx: AppContext, trigger: string, query: string | undefined | null): Promise<MentionProps[]> => {
    if (!query) return []
    const {users, error} = await getUsers(ctx)
    if (!users || error) return []

    const cleanQuery = cleanText(query)

    return users.filter((user) =>
        (user.displayName && cleanText(user.displayName).includes(cleanQuery)) || cleanText(user.handle).includes(cleanQuery),
    ).map(u => ({...u, value: u.did}))
}


export async function setSeenTutorial(ctx: AppContext, agent: SessionAgent, v: boolean) {
    await ctx.db.user.update({
        data: {
            seenTutorial: v
        },
        where: {
            did: agent.did
        }
    })
    // revalidateTag("user:" + did)
}


export async function getCADataForUsers(ctx: AppContext, users: string[]) {
    const data = await ctx.db.user.findMany({
        select: {
            did: true,
            CAProfileUri: true,
            displayName: true,
            handle: true,
            avatar: true
        },
        where: {
            did: {
                in: users
            }
        }
    })

    const res: CAProfileViewBasic[] = []

    data.forEach(u => {
        if (u.handle != null) res.push({
            ...u,
            handle: u.handle,
            displayName: u.displayName ?? undefined,
            avatar: u.avatar ?? undefined,
            caProfile: u.CAProfileUri ?? undefined
        })
    })

    return res
}


export const getFollowx = async (ctx: AppContext, agent: SessionAgent, {handleOrDid, kind}: {handleOrDid: string, kind: "follows" | "followers"}) => {
    const did = await handleToDid(agent, handleOrDid)

    const users = kind == "follows" ?
        (await agent.bsky.getFollows({actor: did})).data.follows :
        (await agent.bsky.getFollowers({actor: did})).data.followers

    const bskyMap = new Map<string, ProfileViewBasic>(users.map(u => [u.did, {...u, $type: "app.bsky.actor.defs#profileViewBasic"}]))
    const caData = await getCADataForUsers(ctx, users.map(u => u.did))
    const caMap = new Map(caData.map(a => [a.did, a]))

    const hData: HydrationData = {
        bskyUsers: bskyMap,
        caUsers: caMap
    }

    let data = users.map(u => hydrateProfileViewBasic(u.did, hData)).filter(x => x != null)
    data = sortByKey(data, (u => [u.caProfile != null ? 1 : 0]), listOrderDesc)

    return {data}
}


export const getFollows: CAHandler<{params: {handleOrDid: string}}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    return await getFollowx(ctx, agent, {handleOrDid: params.handleOrDid, kind: "follows"})
}


export const getFollowers: CAHandler<{params: {handleOrDid: string}}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    return await getFollowx(ctx, agent, {handleOrDid: params.handleOrDid, kind: "followers"})
}