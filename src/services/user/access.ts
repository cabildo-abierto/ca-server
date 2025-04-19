

export async function grantAccess(handle: string): Promise<{error?: string}>{
    const did = await handleToDid(handle)

    try {
        await ctx.db.user.update({
            data: {
                hasAccess: true
            },
            where: {
                did
            }
        })
        revalidateTag("user:"+did)
        return {}
    } catch (error) {
        console.error("Grant access error:", error)
        return {error: "No se encontró el usuario."}
    }
}


export async function createCodes(amount: number){
    await ctx.db.inviteCode.createMany({
        data: new Array(amount).fill({})
    })
}


export async function getAvailableInviteCodes() {
    return (await ctx.db.inviteCode.findMany({
        select: {
            code: true
        },
        where: {
            usedByDid: null
        }
    })).map(({code}) => code)
}


export async function assignInviteCode(inviteCode: string) {
    const did = await getSessionDidNoRevalidate()

    const code = await ctx.db.inviteCode.findUnique({
        where: {
            code: inviteCode
        }
    })

    if(code.usedByDid == did){
        return {}
    }

    if(code.usedByDid != null){
        return {error: "El código ya fue usado."}
    }

    const updates = [
        db.inviteCode.update({
            data: {
                usedAt: new Date(),
                usedByDid: did
            },
            where: {
                code: inviteCode
            }
        }),
        db.user.update({
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

    revalidateTag("user:"+did)

    return {}
}