import {CAHandler} from "#/utils/handler";
import {redisDeleteByPrefix} from "#/services/user/follow-suggestions";


export const clearRedisHandler: CAHandler<{params: {prefix: string}}, {}> = async (ctx, agent, {params}) => {
    console.log("Clearing redis prefix", params.prefix)
    await redisDeleteByPrefix(ctx, params.prefix)
    return {data: {}}
}