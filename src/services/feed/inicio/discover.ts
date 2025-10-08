import {FeedPipelineProps} from "#/services/feed/feed.js";


export const discoverFeedPipeline: FeedPipelineProps = {
    getSkeleton: async () => ({skeleton: [], cursor: undefined}),
    sortKey: (a) => [0]
}