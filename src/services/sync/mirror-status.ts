import {$Enums} from ".prisma/client";
import MirrorStatus = $Enums.MirrorStatus;
import {AppContext} from "#/index";

export async function getUserMirrorStatus(ctx: AppContext, did: string){
    return (await ctx.db.user.findUnique({
        select: {
            mirrorStatus: true
        },
        where: {
            did
        }
    }))?.mirrorStatus ?? null
}


export async function getDirtyUsers(ctx: AppContext){
    return (await ctx.db.user.findMany({
        select: {
            did: true
        },
        where: {
            mirrorStatus: "Dirty",
            inCA: true
        }
    })).map(({did}) => did)
}


export async function setMirrorStatus(ctx: AppContext, did: string, mirrorStatus: MirrorStatus){
    await ctx.db.user.update({
        data: {
            mirrorStatus
        },
        where: {did}
    })
    // revalidateTag("dirtyUsers")
    // revalidateTag("mirrorStatus:"+did)
}