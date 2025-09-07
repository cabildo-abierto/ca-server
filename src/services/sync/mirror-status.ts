import {AppContext} from "#/index";

export type MirrorStatus = "Sync" | "Dirty" | "InProcess" | "Failed" | "Failed - Too Large"

export async function getUserMirrorStatus(ctx: AppContext, did: string, inCA: boolean): Promise<MirrorStatus> {
    const res = await ctx.ioredis.get(mirrorStatusKey(ctx, did, inCA))
    return res ? res as MirrorStatus : "Dirty"
}


export function mirrorStatusKey(ctx: AppContext, did: string, inCA: boolean) {
    return `${ctx.mirrorId}:mirror-status:${did}:${inCA ? "ca" : "ext"}`
}


export function mirrorStatusKeyPrefix(ctx: AppContext) {
    return `${ctx.mirrorId}:mirror-status`
}


export async function setMirrorStatus(ctx: AppContext, did: string, mirrorStatus: MirrorStatus, inCA: boolean){
    await ctx.ioredis.set(mirrorStatusKey(ctx, did, inCA), mirrorStatus)
}