import {GetSkeletonProps} from "#/services/feed/feed";



export const getEditsProfileFeedSkeleton = (did: string) : GetSkeletonProps => {
    return async (ctx, agent, data, cursor) => {

        const skeleton = await ctx.kysely
            .selectFrom("Record")
            .select("uri")
            .where("collection", "=", "ar.cabildoabierto.wiki.topicVersion")
            .where("authorId", "=", did)
            .execute()

        return {
            skeleton: skeleton.map(r => ({post: r.uri})),
            cursor: undefined
        }
    }
}