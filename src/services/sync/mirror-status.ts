import {$Enums} from ".prisma/client";
import MirrorStatus = $Enums.MirrorStatus;

export async function getUserMirrorStatus(did: string){
    return (await unstable_cache(
        async () => {
            return await ctx.db.user.findUnique({
                select: {
                    mirrorStatus: true
                },
                where: {
                    did
                }
            })
        },
        ["mirrorStatus:"+did],
        {
            tags: ["mirrorStatus:"+did, "user:"+did],
            revalidate: revalidateEverythingTime
        }
    )()).mirrorStatus
}


export async function getDirtyUsers(){
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


export async function setMirrorStatus(did: string, mirrorStatus: MirrorStatus){
    await ctx.db.user.update({
        data: {
            mirrorStatus
        },
        where: {did}
    })
    revalidateTag("dirtyUsers")
    revalidateTag("mirrorStatus:"+did)
}