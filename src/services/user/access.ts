import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/setup";
import {isValidHandle} from "@atproto/syntax";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {Record as CAProfileRecord} from "#/lex-server/types/ar/cabildoabierto/actor/caProfile"
import {v4 as uuidv4} from "uuid";
import {range} from "#/utils/arrays";
import {BskyProfileRecordProcessor, CAProfileRecordProcessor} from "#/services/sync/event-processing/profile";
import {AppBskyActorProfile} from "@atproto/api"

async function getCAStatus(ctx: AppContext, did: string): Promise<{inCA: boolean, hasAccess: boolean} | null> {
    return await ctx.kysely
        .selectFrom("User")
        .select(["inCA", "hasAccess"])
        .where("did", "=", did)
        .executeTakeFirst() ?? null
}


export const login: CAHandlerNoAuth<{handle?: string, code?: string}> = async (ctx, agent, {handle, code}) => {

    if (!handle || !isValidHandle(handle.trim())) {
        return {error: "Nombre de usuario inválido."}
    }

    handle = handle.trim()

    const did = await ctx.resolver.resolveHandleToDid(handle)
    if(!did) return {error: "No se encontró el usuario."}

    const status = await getCAStatus(ctx, did)

    if(!status || !status.inCA || !status.hasAccess){
        if(code){
            const {error} = await checkValidCode(ctx, code, did)
            if(error){
                return {error}
            } else {
                // continuamos con el login y usamos el código si el login termina bien
            }
        } else {
            return {error: "Necesitás un código de invitación para crear un usuario nuevo."}
        }
    }

    try {
        const url = await ctx.oauthClient?.authorize(handle, {
            scope: 'atproto transition:generic transition:chat.bsky transition:email',
        })
        return {data: {url}}
    } catch (err) {
        console.error(`Error authorizing ${handle}`, err)
        return {error: "Ocurrió un error al iniciar sesión."}
    }
}


export async function checkValidCode(ctx: AppContext, code: string, did: string){
    const res = await ctx.kysely
        .selectFrom("InviteCode")
        .select(["code", "usedByDid"])
        .where("code", "=", code)
        .executeTakeFirst()
    if(!res) return {error: "El código de invitación es inválido."}
    if(res.usedByDid && res.usedByDid != did) return {error: "El código de invitación ya fue usado."}
    return {}
}


export async function createCAUser(ctx: AppContext, agent: SessionAgent, code?: string) {
    const did = agent.did

    try {
        await ctx.kysely
            .insertInto("User")
            .values([{did}])
            .onConflict(oc => oc.column("did").doNothing())
            .execute()
    } catch (error) {
        ctx.logger.pino.error({error}, "error inserting did for new ca user")
    }
    if(code){
        const {error} = await assignInviteCode(ctx, agent, code)
        if(error) ctx.logger.pino.error({error}, "error assigning invite code")
        if(error) return {error}
    }

    const caProfileRecord: CAProfileRecord = {
        $type: "ar.cabildoabierto.actor.caProfile",
        createdAt: new Date().toISOString()
    }

    try {
        const [{data}, {data: bskyProfile}] = await Promise.all([
            agent.bsky.com.atproto.repo.putRecord({
                repo: did,
                collection: "ar.cabildoabierto.actor.caProfile",
                rkey: "self",
                record: caProfileRecord
            }),
            agent.bsky.com.atproto.repo.getRecord({
                repo: did,
                collection: "app.bsky.actor.profile",
                rkey: "self"
            })
        ])

        const refAndRecordCA = {ref: {uri: data.uri, cid: data.cid}, record: caProfileRecord}
        const refAndRecordBsky = {ref: {uri: bskyProfile.uri, cid: bskyProfile.cid!}, record: bskyProfile.value as AppBskyActorProfile.Record}
        await Promise.all([
            new CAProfileRecordProcessor(ctx)
                .processValidated([refAndRecordCA]),
            new BskyProfileRecordProcessor(ctx)
                .processValidated([refAndRecordBsky])
        ])
    } catch (err) {
        ctx.logger.pino.error({err, caProfileRecord, did}, "error processing profiles for new user")
    }

    return {}
}


export const createInviteCodes: CAHandler<{query: {c: number}}, { inviteCodes: string[] }> = async (ctx, agent, {query}) => {
    console.log(`Creating ${query.c} invite codes.`)
    try {
        const values = range(query.c).map(i => {
            return {
                code: uuidv4()
            }
        })

        await ctx.kysely
            .insertInto("InviteCode")
            .values(values)
            .execute()

        return {data: {inviteCodes: values.map(c => c.code)}}
    } catch (err) {
        console.error(`Error creating invite codes: ${err}`)
        return {error: "Ocurrió un error al crear los códigos de invitación"}
    }
}


export async function assignInviteCode(ctx: AppContext, agent: SessionAgent, inviteCode: string) {
    const did = agent.did
    const [code, user] = await Promise.all([
        ctx.kysely
            .selectFrom("InviteCode")
            .select(["usedByDid"])
            .where("code", "=", inviteCode)
            .executeTakeFirst(),
        ctx.kysely
            .selectFrom("User")
            .leftJoin("InviteCode", "InviteCode.usedByDid", "User.did")
            .select([
                "inCA",
                "hasAccess",
                "code"
            ])
            .where("User.did", "=", did)
            .executeTakeFirst(),
    ])
    if(!code) return {error: "No se encontró el código"}
    if(!user) return {error: "No se encontró el usuario"}

    if(user.code != null && user.inCA && user.hasAccess){
        return {}
    }

    if(code.usedByDid != null){
        return {error: "El código ya fue usado."}
    }

    await ctx.kysely.transaction().execute(async trx => {
        if(!user.code) {
            await trx
                .updateTable("InviteCode")
                .set("usedAt", new Date())
                .set("usedByDid", did)
                .where("code", "=", inviteCode)
                .execute()
        }

        if(!user.hasAccess){
            await trx
                .updateTable("User")
                .set("hasAccess", true)
                .set("inCA", true)
                .where("did", "=", did)
                .execute()
        }
    })


    return {}
}


export const createAccessRequest: CAHandlerNoAuth<{email: string, comment: string}, {}> = async (ctx, agent, params) => {

    try {
        await ctx.kysely.insertInto("AccessRequest").values([{
            email: params.email,
            comment: params.comment,
            id: uuidv4()
        }]).execute()
    } catch {
        return {error: "Ocurrió un error al crear la solicitud :("}
    }

    return {data: {}}
}

type AccessRequest = {
    id: string
    email: string
    comment: string
    createdAt: Date
    sentInviteAt: Date | null
}

export const getAccessRequests: CAHandler<{}, AccessRequest[]> = async (ctx, agent, {}) => {
    const requests: AccessRequest[] = await ctx.kysely
        .selectFrom("AccessRequest")
        .select([
            "email",
            "comment",
            "created_at as createdAt",
            "sentInviteAt",
            "id"
        ])
        .execute()

    return {data: requests}
}


export const markAccessRequestSent: CAHandler<{params: {id: string}}, {}> = async (ctx, agent, {params} ) => {
    await ctx.kysely
        .updateTable("AccessRequest")
        .set("sentInviteAt", new Date())
        .set("sentInviteAt_tz", new Date())
        .where("id", "=", params.id)
        .execute()

    return {data: {}}
}


export const getInviteCodesToShare: CAHandler<{}, {code: string}[]> = async (ctx, agent, {}) => {
    const codes = await ctx.kysely
        .selectFrom("InviteCode")
        .select("code")
        .where("recommenderId", "=", agent.did)
        .where("usedByDid", "is", null)
        .execute()

    if(codes.length == 0){
        const allCodes = await ctx.kysely
            .selectFrom("InviteCode")
            .select("code")
            .where("recommenderId", "=", agent.did)
            .execute()
        if(allCodes.length < 3){
            const values: {
                code: string
                recommenderId: string
                created_at: Date
            }[] = []
            for(let i = 0; i < 3 - allCodes.length; i++){
                const code = uuidv4()
                values.push({
                    code,
                    recommenderId: agent.did,
                    created_at: new Date()
                })
            }
            if(values.length > 0){
                await ctx.kysely
                    .insertInto("InviteCode")
                    .values(values)
                    .execute()
            }
            return {
                data: values.map(c => ({code: c.code}))
            }
        }
    }

    return {
        data: codes
    }
}


export const assignInviteCodesToUsers = async (ctx: AppContext) => {

    await ctx.kysely.transaction().execute(async (db) => {
        const users = await db
            .selectFrom("User")
            .leftJoin("InviteCode", "InviteCode.recommenderId", "User.did")
            .select([
                "User.did",
                (eb) => eb.fn.count<number>("InviteCode.code").as("codeCount"),
            ])
            .where("inCA", "=", true)
            .groupBy("User.did")
            .execute()

        const values: {
            code: string
            recommenderId: string
            created_at: Date
        }[] = []
        users.forEach(u => {
            for(let i = 0; i < 3 - u.codeCount; i++){
                const code = uuidv4()
                values.push({
                    code,
                    recommenderId: u.did,
                    created_at: new Date()
                })
            }
        })
        if(values.length > 0){
            await db
                .insertInto("InviteCode")
                .values(values)
                .execute()
        }
    })
}