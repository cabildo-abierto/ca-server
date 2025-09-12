import {CAHandler} from "#/utils/handler";



export const clearRedisHandler: CAHandler<{params: {prefix: string}}, {}> = async (ctx, agent, {params}) => {
    console.log("Clearing redis prefix", params.prefix)
    await ctx.redisCache.deleteByPrefix(params.prefix)
    return {data: {}}
}