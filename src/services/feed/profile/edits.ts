import {GetSkeletonProps} from "#/services/feed/feed";



export const getEditsProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent) => {
        return (await ctx.db.record.findMany({
            select: {
                uri: true
            },
            where: {
                collection: "ar.cabildoabierto.feed.topic",
                authorId: did
            }
        })).map(({uri}) => ({post: uri}))
    }
}