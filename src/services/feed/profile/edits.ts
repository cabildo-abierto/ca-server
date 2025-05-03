import {GetSkeletonProps} from "#/services/feed/feed";



export const getEditsProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent) => {
        return (await ctx.db.record.findMany({
            select: {
                uri: true
            },
            where: {
                collection: {
                    in: ["ar.cabildoabierto.wiki.topicVersion", "ar.com.cabildoabierto.topic"]
                },
                authorId: did
            }
        })).map(({uri}) => ({post: uri}))
    }
}