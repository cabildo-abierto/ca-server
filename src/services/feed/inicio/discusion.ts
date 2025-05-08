import {FeedPipelineProps, GetSkeletonProps} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";


export const getEnDiscusionSkeleton: GetSkeletonProps = async (ctx, agent, data, cursor) => {
    const skeleton = await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            enDiscusion: true
        }
    }).then(x => x.map(r => ({post: r.uri})))

    return {skeleton, cursor}
}


export const enDiscusionFeedPipeline: FeedPipelineProps = {
    getSkeleton: getEnDiscusionSkeleton,
    sortKey: rootCreationDateSortKey
}


export async function addToEnDiscusion(uri: string){
    // TO DO
}


export async function removeFromEnDiscusion(uri: string){
    // TO DO
}