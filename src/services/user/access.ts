import {getCAUsersHandles} from "#/services/user/users";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {isValidHandle} from "@atproto/syntax";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {Record as CAProfileRecord} from "#/lex-server/types/ar/cabildoabierto/actor/caProfile"
import {processCreate} from "#/services/sync/process-event";
import {Record as BskyProfileRecord} from "#/lex-api/types/app/bsky/actor/profile"


export const login: CAHandlerNoAuth<{handle?: string, code?: string}> = async (ctx, agent, {handle, code}) => {
    if (!handle || !isValidHandle(handle)) {
        return {error: "Nombre de usuario inválido."}
    }

    const caUsers = await getCAUsersHandles(ctx)
    if(!code){
        if(!caUsers.includes(handle)){
            return {error: "Necesitás un código de invitación para crear un usuario nuevo."}
        }
    } else {
        // tiene un cód
        if(!caUsers.includes(handle)){
            const {error} = await checkValidCode(ctx, code)
            if(error){
                return {error}
            } else {
                // continuamos con el login y usamos el código si el login termina bien
            }
        }
    }

    try {
        const url = await ctx.oauthClient.authorize(handle, {
            scope: 'atproto transition:generic',
        })
        return {data: {url}}
    } catch (err) {
        return {error: "Ocurrió un error al iniciar sesión."}
    }
}


export async function checkValidCode(ctx: AppContext, code: string){
    const res = await ctx.db.inviteCode.findUnique({
        select: {
            code: true,
            usedByDid: true
        },
        where: {
            code
        }
    })
    if(!res) return {error: "El código de invitación es inválido."}
    if(res.usedByDid) return {error: "El código de invitación ya fue usado."}
    return {}
}


export async function createCAUser(ctx: AppContext, agent: SessionAgent, code: string) {
    const did = agent.did

    await ctx.db.user.upsert({
        create: {
            did
        },
        update: {
            did
        },
        where: {
            did
        }
    })

    const {error} = await assignInviteCode(ctx, agent, code)
    if(error) return {error}

    const caProfileRecord: CAProfileRecord = {
        $type: "ar.cabildoabierto.actor.caProfile",
        createdAt: new Date().toISOString()
    }

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

    const updates = [
        ...await processCreate(ctx, {uri: data.uri, cid: data.cid}, caProfileRecord),
        ...await processCreate(ctx, {uri: bskyProfile.uri, cid: bskyProfile.cid!}, bskyProfile.value as BskyProfileRecord)
    ]

    await ctx.db.$transaction(updates)

    return {}
}


export async function createCodes(ctx: AppContext, amount: number){
    await ctx.db.inviteCode.createMany({
        data: new Array(amount).fill({})
    })
}


export const getAvailableInviteCodes: CAHandler = async (ctx, agent, {}) => {

    const codes = await ctx.db.inviteCode.findMany({
        select: {
            code: true
        },
        where: {
            usedByDid: null
        }
    })

    return {data: codes.map((c) => c.code)}
}


export async function assignInviteCode(ctx: AppContext, agent: SessionAgent, inviteCode: string) {
    const did = agent.did
    const [code, user] = await Promise.all([
        ctx.db.inviteCode.findUnique({
            where: {
                code: inviteCode
            }
        }),
        ctx.db.user.findUnique({
            select: {
                usedInviteCode: true
            },
            where: {
                did
            }
        })
    ])
    if(!code) return {error: "No se encontró el código"}
    if(!user) return {error: "No se encontró el usuario"}

    if(user.usedInviteCode){
        return {}
    }

    if(code.usedByDid != null){
        return {error: "El código ya fue usado."}
    }

    console.log("Assigning code to user", did, inviteCode)
    const updates = [
        ctx.db.inviteCode.update({
            data: {
                usedAt: new Date(),
                usedByDid: did
            },
            where: {
                code: inviteCode
            }
        }),
        ctx.db.user.update({
            data: {
                hasAccess: true,
                inCA: true
            },
            where: {
                did
            }
        })
    ]

    await ctx.db.$transaction(updates)

    // revalidateTag("user:"+did)

    return {}
}