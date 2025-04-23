import {handleToDid} from "#/services/user/users";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";


export async function grantAccess(ctx: AppContext, agent: SessionAgent, handle: string): Promise<{error?: string}>{
    const did = await handleToDid(agent, handle)

    try {
        await ctx.db.user.update({
            data: {
                hasAccess: true
            },
            where: {
                did
            }
        })
        // revalidateTag("user:"+did)
        return {}
    } catch (error) {
        console.error("Grant access error:", error)
        return {error: "No se encontró el usuario."}
    }
}


export async function createCodes(ctx: AppContext, amount: number){
    await ctx.db.inviteCode.createMany({
        data: new Array(amount).fill({})
    })
}


export async function getAvailableInviteCodes(ctx: AppContext) {
    return (await ctx.db.inviteCode.findMany({
        select: {
            code: true
        },
        where: {
            usedByDid: null
        }
    })).map(({code}) => code)
}


export async function assignInviteCode(ctx: AppContext, agent: SessionAgent, inviteCode: string) {
    const did = agent.did
    const code = await ctx.db.inviteCode.findUnique({
        where: {
            code: inviteCode
        }
    })
    if(!code) {return {error: "No se encontró el código"}}

    if(code.usedByDid == did){
        return {}
    }

    if(code.usedByDid != null){
        return {error: "El código ya fue usado."}
    }

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