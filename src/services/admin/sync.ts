import {CAHandler} from "#/utils/handler";

type UserSyncStatus = {
    did: string
    handle: string | null
    mirrorStatus: string | null
    CAProfile: {
        createdAt: Date
    } | null
}

export const getUsersSyncStatus: CAHandler<{}, UserSyncStatus[]> = async (ctx, agent, {}) => {
    const users = await ctx.db.user.findMany({
        select: {
            did: true,
            handle: true,
            mirrorStatus: true,
            CAProfile: {
                select: {
                    createdAt: true
                }
            }
        },
        where: {
            inCA: true,
            hasAccess: true
        }
    })

    return {data: users}
}