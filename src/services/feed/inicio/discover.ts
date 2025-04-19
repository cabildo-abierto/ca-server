import {AppContext} from "#/index";
import {FeedViewContent} from "#/lexicon-server/types/ar/cabildoabierto/feed/defs";
import {SessionAgent} from "#/utils/session-agent";
import {FeedPipelineProps} from "#/services/feed/feed";


export type GetFeedProps = (ctx: AppContext, agent: SessionAgent) => Promise<{feed: FeedViewContent[], error?: string}>


export const discoverFeedPipeline: FeedPipelineProps = {
    getSkeleton: async () => ([]),
    sortKey: (a) => [0]
}