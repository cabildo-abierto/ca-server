import {AppContext} from "#/index";
import {Account, Profile, Session, ValidationState} from "#/lib/types";
import {cookieOptions, SessionAgent} from "#/utils/session-agent";
import {deleteRecords} from "#/services/delete";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {Dataplane, joinMaps} from "#/services/hydration/dataplane";
import {getIronSession} from "iron-session";
import {createCAUser} from "#/services/user/access";
import {dbUserToProfileViewBasic, TimePeriod} from "#/services/wiki/topics";
import {Record as FollowRecord} from "#/lex-api/types/app/bsky/graph/follow"
import {processFollow} from "#/services/sync/process-event";
import {
    Record as BskyProfileRecord,
    validateRecord as validateBskyProfile
} from "#/lex-api/types/app/bsky/actor/profile"
import {BlobRef} from "@atproto/lexicon";
import {uploadBase64Blob} from "#/services/blob";
import {EnDiscusionMetric, EnDiscusionTime, FeedFormatOption} from "#/services/feed/inicio/discusion";
import {FollowingFeedFilter} from "#/services/feed/feed";


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
            inCA: true,
            hasAccess: true
        }
    })).map(({did}) => did)
}


type UserAccessStatus = {
    did: string
    handle: string | null
    created_at: Date | null
    hasAccess: boolean
    inCA: boolean
    inviteCode: string | null
    mirrorStatus: string
    displayName: string | null
}


export const getUsers: CAHandler<{}, UserAccessStatus[]> = async (ctx, agent, {}) => {
    try {
        const users = await ctx.kysely
            .selectFrom("User")
            .leftJoin("InviteCode", "InviteCode.usedByDid", "User.did")
            .select(["did", "handle", "displayName", "mirrorStatus", "hasAccess", "CAProfileUri", "User.created_at", "inCA", "InviteCode.code"])
            .where(eb => eb.or([
                eb("InviteCode.code", "is not", null),
                eb("User.inCA", "=", true),
                eb("User.hasAccess", "=", true),
                eb("User.CAProfileUri", "is not", null)
            ]))
            .execute()

        function queryToStatus(_: any, i: number): UserAccessStatus {
            const u = users[i]
            return {
                ...u,
                inviteCode: u.code ?? null
            }
        }

        return {data: users.map(queryToStatus)}
    } catch (err) {
        console.log("error getting users", err)
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
    } catch {
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


export type TTOption = EnDiscusionTime | "Ediciones recientes"


export type AlgorithmConfig = {
    following?: {
        filter?: FollowingFeedFilter
        format?: FeedFormatOption
    }
    enDiscusion?: {
        time?: EnDiscusionTime
        metric?: EnDiscusionMetric
        format?: FeedFormatOption
    }
    tt?: {
        time?: TTOption
    }
}


export const getSessionData = async (ctx: AppContext, agent: SessionAgent): Promise<Session | null> => {
    const data = await ctx.db.user.findUnique({
        select: {
            platformAdmin: true,
            editorStatus: true,
            seenTutorial: true,
            seenTopicMaximizedTutorial: true,
            seenTopicMinimizedTutorial: true,
            seenTopicsTutorial: true,
            handle: true,
            displayName: true,
            avatar: true,
            hasAccess: true,
            userValidationHash: true,
            orgValidation: true,
            algorithmConfig: true
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
        seenTutorial: {
            home: data.seenTutorial,
            topics: data.seenTopicsTutorial,
            topicMinimized: data.seenTopicMinimizedTutorial,
            topicMaximized: data.seenTopicMaximizedTutorial
        },
        editorStatus: data.editorStatus,
        platformAdmin: data.platformAdmin,
        validation: getValidationState(data),
        algorithmConfig: (data.algorithmConfig ?? {}) as AlgorithmConfig
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
    if (data) {
        return {data}
    }

    // el usuario no está en la db pero logró iniciar sesión, creamos un nuevo usuario de CA
    const code = params?.code
    if (code) {
        const {error} = await createCAUser(ctx, agent, code)
        if (error) {
            return {error}
        }

        const newUserData = await getSessionData(ctx, agent)
        if (newUserData) {
            return {data: newUserData}
        }
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


type Tutorial = "topic-minimized" | "topic-normal" | "home" | "topics"


export const setSeenTutorial: CAHandler<{params: {tutorial: Tutorial}}, {}> = async (ctx, agent, {params}) => {
    const {tutorial} = params
    const did = agent.did
    console.log("setting seen tutorial", tutorial)
    if(tutorial == "topic-minimized"){
        await ctx.db.user.update({data: {seenTopicMinimizedTutorial: true}, where: {did}})
    } else if(tutorial == "home"){
        await ctx.db.user.update({data: {seenTutorial: true}, where: {did}})
    } else if(tutorial == "topics"){
        await ctx.db.user.update({data: {seenTopicsTutorial: true}, where: {did}})
    } else if(tutorial == "topic-normal"){
        await ctx.db.user.update({data: {seenTopicMaximizedTutorial: true}, where: {did}})
    } else {
        console.log("Unknown tutorial", tutorial)
    }
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
                        avatar: true,
                        userValidationHash: true,
                        orgValidation: true
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
                                avatar: true,
                                userValidationHash: true,
                                orgValidation: true
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

    const userList = unique([...caUsers, ...bskyUsers])

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


export const updateAlgorithmConfig: CAHandler<AlgorithmConfig, {}> = async (ctx, agent, config) => {

    await ctx.kysely
        .updateTable("User")
        .set("algorithmConfig", JSON.stringify(config))
        .where("did", "=", agent.did)
        .execute()

    return {data: {}}
}