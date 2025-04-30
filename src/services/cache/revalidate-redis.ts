import {AppContext} from "#/index";


export const revalidateRedis = async (ctx: AppContext, keys: (string | string[])[]) => {
    await ctx.redis.del(keys.map(k => Array.isArray(k) ? k.join(":") : k))
}


async function deleteKeysByPrefix(ctx: AppContext, prefix: string) {
    let cursor = 0;
    do {
        const { cursor: nextCursor, keys } = await ctx.redis.scan(cursor, {
            MATCH: `${prefix}*`,
            COUNT: 100,
        });

        if (keys.length > 0) {
            await ctx.redis.del(keys)
        }

        cursor = Number(nextCursor);
    } while (cursor !== 0);
}


export const revalidateRedisAll = async (ctx: AppContext) => {
    await deleteKeysByPrefix(ctx, "currentVersion:")
}