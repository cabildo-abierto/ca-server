import {FeedPipelineProps, GetSkeletonProps} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";



export const getEnDiscusionSkeleton: GetSkeletonProps = async (ctx) => {
    return ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            enDiscusion: true
        }
    }).then(x => x.map(r => ({post: r.uri})))
}


export const enDiscusionFeedPipeline: FeedPipelineProps = {
    getSkeleton: getEnDiscusionSkeleton,
    sortKey: rootCreationDateSortKey
}