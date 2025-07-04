import {AppContext} from "#/index";
import {ProfileView} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {Account, MentionProps, Profile, Session, UserStats, ValidationState} from "#/lib/types";
import {cookieOptions, SessionAgent} from "#/utils/session-agent";
import {deleteRecords} from "#/services/delete";
import {cleanText} from "#/utils/strings";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {Dataplane, joinMaps} from "#/services/hydration/dataplane";
import {getIronSession} from "iron-session";
import {createCAUser} from "#/services/user/access";
import {dbUserToProfileViewBasic} from "#/services/wiki/topics";
import {Record as FollowRecord} from "#/lex-api/types/app/bsky/graph/follow"
import {processCreate, processFollow} from "#/services/sync/process-event";
import {
    Record as BskyProfileRecord,
    validateRecord as validateBskyProfile
} from "#/lex-api/types/app/bsky/actor/profile"
import {BlobRef} from "@atproto/lexicon";
import {uploadBase64Blob} from "#/services/blob";


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


export async function dbHandleToDid(ctx: AppContext, handleOrDid: string): Promise<string | null> {
    if (handleOrDid.startsWith("did")) {
        return handleOrDid
    } else {
        const res = await ctx.db.user.findFirst({
            select: {
                did: true
            },
            where: {
                handle: handleOrDid
            }
        })
        return res?.did ?? null
    }
}


export async function handleToDid(ctx: AppContext, agent: SessionAgent, handleOrDid: string): Promise<string | null> {
    if (handleOrDid.startsWith("did")) {
        return handleOrDid
    } else {
        try {
            return await ctx.resolver.resolveHandleToDid(handleOrDid)
        } catch (err) {
            console.error("Error in handleToDid:", handleOrDid)
            console.error(err)
            return null
        }
    }
}


export async function didToHandle(ctx: AppContext, did: string): Promise<string | null> {
    return await ctx.resolver.resolveDidToHandle(did)
}


export const getCAUsersHandles = async (ctx: AppContext) => {
    return (await ctx.db.user.findMany({
        select: {
            handle: true
        },
        where: {
            inCA: true
        }
    })).map(({handle}) => handle)
}


export const getCAUsersDids = async (ctx: AppContext) => {
    return (await ctx.db.user.findMany({
        select: {
            did: true
        },
        where: {
            inCA: true
        }
    })).map(({did}) => did)
}


export const getUsers: CAHandler<{}, CAProfileViewBasic[]> = async (ctx, agent, {}) => {
    try {
        const dids = await getCAUsersDids(ctx)

        const dataplane = new Dataplane(ctx, agent)

        await dataplane.fetchUsersHydrationData(dids)

        const users = dids.map(d => hydrateProfileViewBasic(d, dataplane)).filter(x => x != null)

        return {data: users}
    } catch (error) {
        return {error: "Error al obtener a los usuarios."}
    }
}


export const follow: CAHandler<{ followedDid: string }, { followUri: string }> = async (ctx, agent, {followedDid}) => {
    try {
        const res = await agent.bsky.follow(followedDid)
        const record: FollowRecord = {
            $type: "app.bsky.graph.follow",
            subject: followedDid,
            createdAt: new Date().toISOString()
        }
        await processFollow(ctx, res, record)
        return {data: {followUri: res.uri}}
    } catch {
        return {error: "Error al seguir al usuario."}
    }
}


export const unfollow: CAHandler<{ followUri: string }> = async (ctx, agent, {followUri}) => {
    try {
        await deleteRecords({ctx, agent, uris: [followUri], atproto: true})
        return {data: {}}
    } catch (err) {
        console.error(err)
        return {error: "Error al dejar de seguir al usuario."}
    }
}


export const getProfile: CAHandler<{ params: { handleOrDid: string } }, Profile> = async (ctx, agent, {params}) => {
    const did = await handleToDid(ctx, agent, params.handleOrDid)
    if (!did) return {error: "No se encontró el usuario."}

    try {
        const [bskyProfile, caProfile, caFollowsCount, caFollowersCount] = await Promise.all([
            agent.bsky.getProfile({actor: did}),
            ctx.db.user.findUnique({
                select: {
                    inCA: true,
                    editorStatus: true,
                    userValidationHash: true,
                    orgValidation: true
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

        const profile: Profile = {
            bsky: bskyProfile.data,
            ca: {
                ...caProfile,
                inCA: caProfile?.inCA ?? false,
                followsCount: caFollowsCount,
                followersCount: caFollowersCount,
                validation: caProfile ? getValidationState(caProfile) : null
            }
        }

        return {
            data: profile
        }
    } catch (err) {
        return {error: "No se encontró el usuario."}
    }
}


export async function deleteSession(ctx: AppContext, agent: SessionAgent) {
    await ctx.oauthClient.revoke(agent.did)
    if (agent.req && agent.res) {
        const session = await getIronSession<Session>(agent.req, agent.res, cookieOptions)
        session.destroy()
    }
}


export const getSessionData = async (ctx: AppContext, agent: SessionAgent): Promise<Session | null> => {
    const data = await ctx.db.user.findUnique({
        select: {
            platformAdmin: true,
            editorStatus: true,
            seenTutorial: true,
            handle: true,
            displayName: true,
            avatar: true,
            hasAccess: true,
            userValidationHash: true,
            orgValidation: true
        },
        where: {
            did: agent.did
        }
    })
    if (!data || !data.handle) return null
    return {
        did: agent.did,
        handle: data.handle,
        displayName: data.displayName,
        avatar: data.avatar,
        hasAccess: data.hasAccess,
        seenTutorial: data.seenTutorial,
        editorStatus: data.editorStatus,
        platformAdmin: data.platformAdmin,
        validation: getValidationState(data)
    }
}


export function getValidationState(user: {
    userValidationHash: string | null,
    orgValidation: string | null
}): ValidationState {
    return user.userValidationHash ? "persona" : (user.orgValidation ? "org" : null)
}


export const getSession: CAHandlerNoAuth<{ params?: { code?: string } }, Session> = async (ctx, agent, {params}) => {
    if (!agent.hasSession()) {
        return {error: "No session."}
    }

    const data = await getSessionData(ctx, agent)
    if (data) return {data}

    // el usuario no está en la db pero logró iniciar sesión, creamos un nuevo usuario de CA
    const code = params?.code
    if (code) {
        const {error} = await createCAUser(ctx, agent, code)
        if (error) return {error}

        const newUserData = await getSessionData(ctx, agent)
        if (newUserData) return {data: newUserData}
    }

    await deleteSession(ctx, agent)
    return {error: "Ocurrió un error al crear el usuario."} // no debería pasar (!)
}


export const getAccount: CAHandler<{}, Account> = async (ctx, agent) => {

    const [caData, bskySession] = await Promise.all([
        ctx.db.user.findUnique({
            select: {
                email: true
            },
            where: {
                did: agent.did
            }
        }),
        agent.bsky.com.atproto.server.getSession()
    ])

    if(!caData){
        return {error: "No se encontró el usuario"}
    }

    const bskyEmail = bskySession.data.email

    if(bskyEmail && (!caData.email || caData.email != bskyEmail)){
        await ctx.db.user.update({
            data: {
                email: bskyEmail
            },
            where: {
                did: agent.did
            }
        })
    }

    return {
        data: {
            email: bskyEmail
        }
    }
}


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


export async function searchATProtoUsers(agent: SessionAgent, q: string): Promise<{
    users?: ProfileView[],
    error?: string
}> {
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


/*export const queryMentions = async (ctx: AppContext, trigger: string, query: string | undefined | null): Promise<MentionProps[]> => {
    if (!query) return []
    const {users, error} = await getUsers(ctx)
    if (!users || error) return []

    const cleanQuery = cleanText(query)

    return users.filter((user) =>
        (user.displayName && cleanText(user.displayName).includes(cleanQuery)) || cleanText(user.handle).includes(cleanQuery),
    ).map(u => ({...u, value: u.did}))
}*/


export const setSeenTutorial: CAHandler = async (ctx, agent) => {
    await ctx.db.user.update({
        data: {
            seenTutorial: true
        },
        where: {
            did: agent.did
        }
    })
    return {data: {}}
}


async function getFollowxFromCA(ctx: AppContext, did: string, data: Dataplane, kind: "follows" | "followers") {
    const users = kind == "follows" ?
        (await ctx.db.follow.findMany({
            select: {
                userFollowed: {
                    select: {
                        did: true,
                        handle: true,
                        displayName: true,
                        CAProfileUri: true,
                        avatar: true
                    }
                }
            },
            where: {
                record: {
                    authorId: did
                }
            }
        })).map(u => u.userFollowed) :
        (await ctx.db.follow.findMany({
            select: {
                record: {
                    select: {
                        author: {
                            select: {
                                did: true,
                                handle: true,
                                displayName: true,
                                CAProfileUri: true,
                                avatar: true
                            }
                        }
                    }
                }
            },
            where: {
                userFollowedId: did
            }
        })).map(u => u.record.author)

    const views: CAProfileViewBasic[] = users.map(dbUserToProfileViewBasic).filter(u => u != null)

    data.caUsers = joinMaps(data.caUsers, new Map(views.map(u => [u.did, u])))
    return views.map(u => u.did)
}


async function getFollowxFromBsky(agent: SessionAgent, did: string, data: Dataplane, kind: "follows" | "followers") {
    const users = kind == "follows" ?
        (await agent.bsky.getFollows({actor: did})).data.follows :
        (await agent.bsky.getFollowers({actor: did})).data.followers

    data.bskyUsers = joinMaps(data.bskyUsers,
        new Map(users.map(u => [u.did, {
            ...u,
            $type: "app.bsky.actor.defs#profileViewBasic"
        }])))
    return users.map(u => u.did)
}


export const getFollowx = async (ctx: AppContext, agent: SessionAgent, {handleOrDid, kind}: {
    handleOrDid: string,
    kind: "follows" | "followers"
}): Promise<{ data?: CAProfileViewBasic[], error?: string }> => {
    const did = await handleToDid(ctx, agent, handleOrDid)
    if (!did) return {error: "No se encontró el usuario."}

    const data = new Dataplane(ctx, agent)

    const [caUsers, bskyUsers] = await Promise.all([
        getFollowxFromCA(ctx, did, data, kind),
        getFollowxFromBsky(agent, did, data, kind)
    ])

    console.log("caUsers", caUsers)

    console.log("bskyUsers", bskyUsers)

    const userList = unique([...caUsers, ...bskyUsers])

    console.log("userList", userList)

    await data.fetchUsersHydrationData(userList)

    return {data: userList.map(u => hydrateProfileViewBasic(u, data)).filter(u => u != null)}
}


export const getFollows: CAHandler<{
    params: { handleOrDid: string }
}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    return await getFollowx(ctx, agent, {handleOrDid: params.handleOrDid, kind: "follows"})
}


export const getFollowers: CAHandler<{
    params: { handleOrDid: string }
}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    return await getFollowx(ctx, agent, {handleOrDid: params.handleOrDid, kind: "followers"})
}


type UpdateProfileProps = {
    displayName?: string
    description?: string
    banner?: string
    profilePic?: string
}


export const updateProfile: CAHandler<UpdateProfileProps, {}> = async (ctx, agent, params) => {
    const {data} = await agent.bsky.com.atproto.repo.getRecord({
        repo: agent.did,
        collection: 'app.bsky.actor.profile',
        rkey: "self"
    })

    const val = validateBskyProfile(data.value)


    if (val.success) {
        const record = val.value

        const avatarBlob: BlobRef | undefined = params.profilePic ? (await uploadBase64Blob(agent, params.profilePic)).ref : record.avatar
        const bannerBlob: BlobRef | undefined = params.banner ? (await uploadBase64Blob(agent, params.banner)).ref : record.banner

        const newRecord: BskyProfileRecord = {
            ...record,
            displayName: params.displayName ?? record.displayName,
            description: params.description ?? record.description,
            avatar: avatarBlob,
            banner: bannerBlob
        }
        await agent.bsky.com.atproto.repo.putRecord({
            repo: agent.did,
            collection: "app.bsky.actor.profile",
            record: newRecord,
            rkey: "self"
        })
    }

    return {data: {}}
}


const bskyDid = "did:plc:z72i7hdynmk6r22z27h6tvur"

export const clearFollows: CAHandler<{}, {}> = async (ctx, agent, {}) => {
    const {data: follows} = await getFollows(ctx, agent, {params: {handleOrDid: agent.did}})

    if (follows && follows.length == 1 && follows[0].did == bskyDid && follows[0].viewer?.following) {
        await unfollow(ctx, agent, {followUri: follows[0].viewer.following})
    }

    return {data: {}}
}