import {AppContext} from "#/setup";
import {DeleteProcessor} from "#/services/sync/event-processing/delete-processor";
import {ArticleDeleteProcessor} from "#/services/sync/event-processing/article";
import {DatasetDeleteProcessor} from "#/services/sync/event-processing/dataset";
import {PostDeleteProcessor} from "#/services/sync/event-processing/post";
import {FollowDeleteProcessor} from "#/services/sync/event-processing/follow";
import {CAProfileDeleteProcessor} from "#/services/sync/event-processing/profile";
import {TopicVersionDeleteProcessor} from "#/services/sync/event-processing/topic";
import {ReactionDeleteProcessor} from "#/services/sync/event-processing/reaction";

export function getDeleteProcessor(ctx: AppContext, collection: string) {
    const processor = collectionToProcessorMap[collection]

    if (processor) {
        return new processor(ctx)
    } else {
        return new DeleteProcessor(ctx)
    }
}

type RecordProcessorConstructor = new (ctx: AppContext) => DeleteProcessor;
const collectionToProcessorMap: Record<string, RecordProcessorConstructor> = {
    "ar.cabildoabierto.feed.article": ArticleDeleteProcessor,
    "ar.cabildoabierto.data.dataset": DatasetDeleteProcessor,
    "app.bsky.feed.post": PostDeleteProcessor,
    "app.bsky.actor.profile": DeleteProcessor,
    "app.bsky.graph.follow": FollowDeleteProcessor,
    "ar.cabildoabierto.actor.caProfile": CAProfileDeleteProcessor,
    "ar.com.cabildoabierto.profile": CAProfileDeleteProcessor,
    "ar.cabildoabierto.wiki.topicVersion": TopicVersionDeleteProcessor,
    "app.bsky.feed.like": ReactionDeleteProcessor,
    "app.bsky.feed.repost": ReactionDeleteProcessor,
    "ar.cabildoabierto.wiki.voteAccept": ReactionDeleteProcessor,
    "ar.cabildoabierto.wiki.voteReject": ReactionDeleteProcessor,
}