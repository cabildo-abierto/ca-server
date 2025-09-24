import {AppContext} from "#/setup";
import {Account, ATProtoStrongRef, AuthorStatus, CAProfile, Profile, Session, ValidationState} from "#/lib/types";
import {Agent, cookieOptions, SessionAgent} from "#/utils/session-agent";
import {deleteRecords} from "#/services/delete";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {Dataplane, joinMaps} from "#/services/hydration/dataplane";
import {getIronSession} from "iron-session";
import {createCAUser} from "#/services/user/access";
import {Record as FollowRecord} from "#/lex-api/types/app/bsky/graph/follow"
import {
    Record as BskyProfileRecord,
    validateRecord as validateBskyProfile
} from "#/lex-api/types/app/bsky/actor/profile"
import {BlobRef} from "@atproto/lexicon";
import {uploadBase64Blob} from "#/services/blob";
import {EnDiscusionMetric, EnDiscusionTime, FeedFormatOption} from "#/services/feed/inicio/discusion";
import {FollowingFeedFilter} from "#/services/feed/feed";
import {BskyProfileRecordProcessor} from "#/services/sync/event-processing/profile";
import {FollowRecordProcessor} from "#/services/sync/event-processing/follow";
import {ViewerState} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {getDidFromUri} from "#/utils/uri";
import {getCAFollowersDids, getCAFollowsDids} from "#/services/feed/inicio/following";



export async function dbHandleToDid(ctx: AppContext, handleOrDid: string): Promise<string | null> {
    if (handleOrDid.startsWith("did")) {
        return handleOrDid
    } else {
        const res = await ctx.kysely
            .selectFrom("User")
            .select("did")
            .where("handle", "=", handleOrDid)
            .executeTakeFirst()
        return res?.did ?? null
    }
}


export async function handleToDid(ctx: AppContext, agent: Agent, handleOrDid: string): Promise<string | null> {
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


export const getCAUsersDids = async (ctx: AppContext) => {
    return (await ctx.kysely
        .selectFrom("User")
        .select("did")
        .where("inCA", "=", true)
        .where("hasAccess", "=", true)
        .execute()).map(({did}) => did)
}


type UserAccessStatus = {
    did: string
    handle: string | null
    created_at: Date | null
    hasAccess: boolean
    inCA: boolean
    inviteCode: string | null
    displayName: string | null
}


export const getUsers: CAHandler<{}, UserAccessStatus[]> = async (ctx, agent, {}) => {
    try {
        const users = await ctx.kysely
            .selectFrom("User")
            .leftJoin("InviteCode", "InviteCode.usedByDid", "User.did")
            .select(["did", "handle", "displayName", "hasAccess", "CAProfileUri", "User.created_at", "inCA", "InviteCode.code"])
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
        await new FollowRecordProcessor(ctx).processValidated([{ref: res, record}])
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


async function getCAProfileQuery(ctx: AppContext, did: string){
    const profiles = await ctx.kysely
        .selectFrom("User")
        .select([
            "inCA",
            "editorStatus",
            "userValidationHash",
            "orgValidation",
            (eb) =>
                eb
                    .selectFrom("Follow")
                    .innerJoin("Record", "Record.uri", "Follow.uri")
                    .innerJoin("User", "User.did", "Record.authorId")
                    .select(eb.fn.countAll<number>().as("count"))
                    .where("User.inCA", "=", true)
                    .where("Follow.userFollowedId", "=", did)
                    .as("followersCount"),
            (eb) =>
                eb
                    .selectFrom("Record")
                    .where("Record.authorId", "=", did)
                    .innerJoin("Follow", "Follow.uri", "Record.uri")
                    .innerJoin("User as UserFollowed", "UserFollowed.did", "Follow.userFollowedId")
                    .where("UserFollowed.inCA", "=", true)
                    .select(eb.fn.countAll<number>().as("count"))
                    .as("followsCount"),
            (eb) =>
                eb
                    .selectFrom("Record")
                    .innerJoin("Article", "Article.uri", "Record.uri")
                    .select(eb.fn.countAll<number>().as("count"))
                    .where("Record.authorId", "=", did)
                    .where("Record.collection", "=", "ar.cabildoabierto.feed.article")
                    .as("articlesCount"),
            (eb) =>
                eb
                    .selectFrom("Record")
                    .innerJoin("TopicVersion", "TopicVersion.uri", "Record.uri")
                    .select(eb.fn.countAll<number>().as("count"))
                    .where("Record.authorId", "=", did)
                    .where("Record.collection", "=", "ar.cabildoabierto.wiki.topicVersion")
                    .as("editsCount"),
        ])
        .where("User.did", "=", did)
        .execute()

    if (profiles.length == 0) return null

    const profile = profiles[0]

    return {
        editorStatus: profile.editorStatus,
        inCA: profile.inCA ?? null,
        followsCount: profile.followsCount ?? 0,
        followersCount: profile.followersCount ?? 0,
        articlesCount: profile.articlesCount ?? 0,
        editsCount: profile.editsCount ?? 0,
        validation: getValidationState(profile)
    }
}


async function getCAProfile(ctx: AppContext, agent: Agent, did: string): Promise<CAProfile | null> {
    return await getCAProfileQuery(ctx, did)
}


async function getViewerForProfile(ctx: AppContext, agent: Agent, did: string): Promise<ViewerState | null> {
    if(!agent.hasSession()) return null
    const status = await ctx.redisCache.mirrorStatus.get(agent.did, true)
    if(status != "Sync"){
        return null
    }
    const follows = await ctx.kysely
        .selectFrom("Follow")
        .innerJoin("Record", "Record.uri", "Follow.uri")
        .select("Follow.uri")
        .where("Follow.userFollowedId", "in", [did, agent.did])
        .where("Record.authorId", "in", [did, agent.did])
        .execute()

    if(follows.length == 0){
        return null
    }

    const following = follows.find(f => getDidFromUri(f.uri) == agent.did)
    const followedBy = follows.find(f => getDidFromUri(f.uri) == did)

    return {
        following: following ? following.uri : undefined,
        followedBy: followedBy ? followedBy.uri : undefined
    }
}


export const getProfile: CAHandlerNoAuth<{ params: { handleOrDid: string } }, Profile> = async (ctx, agent, {params}) => {
    try {
        const t1 = Date.now()
        const did = await handleToDid(ctx, agent, params.handleOrDid)
        if (!did) return {error: "No se encontró el usuario."}
        const t2 = Date.now()

        const [cached, viewer] = await Promise.all([
            ctx.redisCache.profile.get(did),
            getViewerForProfile(ctx, agent, did)
        ])

        const t3 = Date.now()
        if(cached && viewer != null) {
            ctx.logger.logTimes(`cache hit en perfil ${did}`, [t1, t2, t3])
            return {
                data: {
                    ca: cached.ca,
                    bsky: {
                        ...cached.bsky,
                        viewer
                    }
                }
            }
        }

        const [bskyProfile, caProfile] = await Promise.all([
            agent.bsky.app.bsky.actor.getProfile({actor: params.handleOrDid}),
            getCAProfile(ctx, agent, did)
        ])

        const t4 = Date.now()

        const profile: Profile = {
            bsky: bskyProfile.data,
            ca: caProfile
        }

        const t5 = Date.now()

        await ctx.redisCache.profile.set(did, profile)

        ctx.logger.logTimes("perfil", [t1, t2, t3, t4, t5])

        return {data: profile}
    } catch (err) {
        console.log("Error getting profile", err)
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

type SessionData = Omit<Session, "handle"> & {handle: string | null}

export const getSessionData = async (ctx: AppContext, did: string): Promise<SessionData | null> => {
    const res = await ctx.kysely
        .selectFrom("User")
        .select([
            "platformAdmin",
            "editorStatus",
            "seenTutorial",
            "seenTopicMaximizedTutorial",
            "seenTopicMinimizedTutorial",
            "seenTopicsTutorial",
            "handle",
            "displayName",
            "avatar",
            "hasAccess",
            "userValidationHash",
            "orgValidation",
            "algorithmConfig",
            "authorStatus",
        ])
        .where("did", "=", did)
        .executeTakeFirst()

    if(!res) return null

    const data = res

    return {
        authorStatus: data.authorStatus as AuthorStatus | null,
        did: did,
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


function isFullSessionData(data: SessionData | null): data is Session {
    return data != null && data.handle != null
}


export const getSession: CAHandlerNoAuth<{ params?: { code?: string } }, Session> = async (ctx, agent, {params}) => {
    if (!agent.hasSession()) {
        return {error: "No session."}
    }

    const data = await getSessionData(ctx, agent.did)
    if (isFullSessionData(data) && data.hasAccess) {
        return {data}
    }

    const code = params?.code

    if(data && data.hasAccess) {
        // está en le DB y tiene acceso pero no está sincronizado (sin handle)
        const {error} = await createCAUser(ctx, agent)
        if (error) {
            return {error}
        }

        const newUserData = await getSessionData(ctx, agent.did)
        if (isFullSessionData(newUserData)) {
            return {data: newUserData}
        }
    } else if (code) {
        // el usuario no está en la db (o está pero no tiene acceso) y logró iniciar sesión, creamos un nuevo usuario de CA
        const {error} = await createCAUser(ctx, agent, code)
        if (error) {
            return {error}
        }

        const newUserData = await getSessionData(ctx, agent.did)
        if (isFullSessionData(newUserData)) {
            return {data: newUserData}
        }
    }

    await deleteSession(ctx, agent)
    return {error: "Ocurrió un error al crear el usuario."}
}


export const getAccount: CAHandler<{}, Account> = async (ctx, agent) => {

    const [caData, bskySession] = await Promise.all([
        ctx.kysely.selectFrom("User").select("email").where("did", "=", agent.did).executeTakeFirst(),
        agent.bsky.com.atproto.server.getSession()
    ])

    if (!caData) {
        return {error: "No se encontró el usuario"}
    }

    const bskyEmail = bskySession.data.email

    if (bskyEmail && (!caData.email || caData.email != bskyEmail)) {
        await ctx.kysely.updateTable("User")
            .set("email", bskyEmail)
            .where("did", "=", agent.did)
            .execute()
    }

    return {
        data: {
            email: bskyEmail
        }
    }
}


type Tutorial = "topic-minimized" | "topic-normal" | "home" | "topics"


export const setSeenTutorial: CAHandler<{ params: { tutorial: Tutorial } }, {}> = async (ctx, agent, {params}) => {
    const {tutorial} = params
    const did = agent.did
    console.log("setting seen tutorial", tutorial)
    if (tutorial == "topic-minimized") {
        await ctx.kysely.updateTable("User").set("seenTopicMinimizedTutorial", true).where("did", "=", did).execute()
    } else if (tutorial == "home") {
        await ctx.kysely.updateTable("User").set("seenTutorial", true).where("did", "=", did).execute()
    } else if (tutorial == "topics") {
        await ctx.kysely.updateTable("User").set("seenTopicsTutorial", true).where("did", "=", did).execute()
    } else if (tutorial == "topic-normal") {
        await ctx.kysely.updateTable("User").set("seenTopicMaximizedTutorial", true).where("did", "=", did).execute()
    } else if (tutorial == "panel-de-autor") {
        await ctx.kysely.updateTable("User")
            .set("authorStatus", {
                isAuthor: true,
                seenAuthorTutorial: true
            })
            .where("did", "=", did)
            .execute()
    } else {
        console.log("Unknown tutorial", tutorial)
    }
    return {data: {}}
}


async function getFollowxFromCA(ctx: AppContext, did: string, data: Dataplane, kind: "follows" | "followers") {
    const dids = kind == "follows" ?
        await getCAFollowsDids(ctx, did) :
        await getCAFollowersDids(ctx, did)

    await data.fetchUsersHydrationData(dids)
    const views = dids
        .map(u => hydrateProfileViewBasic(u, data))
        .filter(u => u != null)

    const m = new Map(views.map(u => [u.did, u]))
    data.caUsers = joinMaps(data.caUsers, m)
    return views.map(u => u.did)
}


async function getFollowxFromBsky(agent: Agent, did: string, data: Dataplane, kind: "follows" | "followers") {
    const users = kind == "follows" ?
        (await agent.bsky.app.bsky.graph.getFollows({actor: did})).data.follows :
        (await agent.bsky.app.bsky.graph.getFollowers({actor: did})).data.followers

    data.bskyUsers = joinMaps(data.bskyUsers,
        new Map(users.map(u => [u.did, {
            ...u,
            $type: "app.bsky.actor.defs#profileViewBasic"
        }])))
    return users.map(u => u.did)
}


export const getFollowx = async (ctx: AppContext, agent: Agent, {handleOrDid, kind}: {
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


export const getFollows: CAHandlerNoAuth<{
    params: { handleOrDid: string }
}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    return await getFollowx(ctx, agent, {handleOrDid: params.handleOrDid, kind: "follows"})
}


export const getFollowers: CAHandlerNoAuth<{
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

        if(data.cid){
            const ref: ATProtoStrongRef = {
                uri: data.uri,
                cid: data.cid
            }

            await new BskyProfileRecordProcessor(ctx)
                .processValidated([{ref, record}])
        }
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


export async function updateAuthorStatus(ctx: AppContext, dids?: string[]) {
    if(dids && dids.length == 0) return

    const query = ctx.kysely
        .selectFrom("User")
        .select([
            "did",
            "authorStatus",
            (eb) =>
                eb
                    .selectFrom("Record")
                    .select(eb => eb.fn.count<number>("uri").as("articlesCount"))
                    .whereRef("Record.authorId", "=", "User.did")
                    .where("Record.collection", "=", "ar.cabildoabierto.feed.article")
                    .as("articlesCount"),
            (eb) =>
                eb
                    .selectFrom("Record")
                    .select(eb => eb.fn.count<number>("uri").as("topicVersionsCount"))
                    .whereRef("Record.authorId", "=", "User.did")
                    .where("Record.collection", "=", "ar.cabildoabierto.wiki.topicVersion")
                    .as("topicVersionsCount")
        ])
        .where("inCA", "=", true)

    const users = dids ? await query.where("did", "in", dids).execute() : await query.execute()

    const values: {
        did: string,
        authorStatus: string
    }[] = users.map(u => {

        const authorStatus  = u.authorStatus as AuthorStatus | null

        const newAuthorStatus = {
            isAuthor: authorStatus && authorStatus.isAuthor || u.articlesCount && u.articlesCount > 0 || u.topicVersionsCount && u.topicVersionsCount > 0,
            seenAuthorTutorial: authorStatus && authorStatus.seenAuthorTutorial
        }

        return {
            did: u.did,
            authorStatus: JSON.stringify(newAuthorStatus)
        }
    })

    if(values.length == 0) return

    await ctx.kysely
        .insertInto("User")
        .values(values)
        .onConflict(oc => oc.column("did").doUpdateSet(eb => ({
            authorStatus: eb.ref("excluded.authorStatus")
        })))
        .execute()
}