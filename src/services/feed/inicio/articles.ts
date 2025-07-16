import {FeedPipelineProps, GetSkeletonProps} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";

const getArticlesFeedSkeleton: GetSkeletonProps = async (ctx, agent) => {
    const skeleton = await ctx.kysely
        .selectFrom("Article")
        .select(["uri"])
        .execute()

    return {
        skeleton: skeleton.map(e => ({post: e.uri})),
        cursor: undefined
    }
}

export const articlesFeedPipeline: FeedPipelineProps = {
    getSkeleton: getArticlesFeedSkeleton,
    sortKey: rootCreationDateSortKey
}