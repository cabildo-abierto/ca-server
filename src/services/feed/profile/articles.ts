import {GetSkeletonProps} from "#/services/feed/feed";


export const getArticlesProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent, data, cursor) => {
        const skeleton = (await ctx.db.record.findMany({
            select: {
                uri: true,
                createdAt: true
            },
            where: {
                authorId: did,
                collection: {
                    in: ["ar.cabildoabierto.feed.article", "ar.com.cabildoabierto.article"]
                },
                createdAt: cursor ? {
                    lte: new Date(cursor)
                } : undefined
            }
        })).map(({uri, createdAt}) => ({post: uri, createdAt}))

        return {
            skeleton,
            cursor: undefined
        }
    }
}
