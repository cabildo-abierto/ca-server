import {RecordProcessor} from "#/services/sync/event-processing/record-processor";
import {
    BskyProfileRecordProcessor,
    CAProfileRecordProcessor,
    OldCAProfileRecordProcessor
} from "#/services/sync/event-processing/profile";
import {
    LikeRecordProcessor,
    RepostRecordProcessor,
    VoteAcceptRecordProcessor,
    VoteRejectRecordProcessor
} from "#/services/sync/event-processing/reaction";
import {ArticleRecordProcessor} from "#/services/sync/event-processing/article";
import {FollowRecordProcessor} from "#/services/sync/event-processing/follow";
import {TopicVersionRecordProcessor} from "#/services/sync/event-processing/topic";
import {DatasetRecordProcessor} from "#/services/sync/event-processing/dataset";
import {PostRecordProcessor} from "#/services/sync/event-processing/post";
import {getCollectionFromUri} from "#/utils/uri";
import {getDeleteProcessor} from "#/services/sync/event-processing/get-delete-processor";
import {AppContext} from "#/setup";

type RecordProcessorConstructor = new (ctx: AppContext) => RecordProcessor<any>;

const collectionToProcessorMap: Record<string, RecordProcessorConstructor> = {
    "app.bsky.actor.profile": BskyProfileRecordProcessor,
    "app.bsky.feed.like": LikeRecordProcessor,
    "ar.cabildoabierto.feed.article": ArticleRecordProcessor,
    "app.bsky.feed.repost": RepostRecordProcessor,
    "app.bsky.graph.follow": FollowRecordProcessor,
    "ar.cabildoabierto.actor.caProfile": CAProfileRecordProcessor,
    "ar.com.cabildoabierto.profile": OldCAProfileRecordProcessor,
    "ar.cabildoabierto.wiki.topicVersion": TopicVersionRecordProcessor,
    "ar.cabildoabierto.wiki.voteAccept": VoteAcceptRecordProcessor,
    "ar.cabildoabierto.wiki.voteReject": VoteRejectRecordProcessor,
    "ar.cabildoabierto.data.dataset": DatasetRecordProcessor,
    "app.bsky.feed.post": PostRecordProcessor
}


export function getRecordProcessor(ctx: AppContext, collection: string) {
    const processor = collectionToProcessorMap[collection]

    if (processor) {
        return new processor(ctx)
    } else {
        return new RecordProcessor(ctx)
    }
}

export async function batchDeleteRecords(ctx: AppContext, uris: string[]) {
    const byCollections = new Map<string, string[]>()
    uris.forEach(r => {
        const c = getCollectionFromUri(r)
        byCollections.set(c, [...(byCollections.get(c) ?? []), r])
    })
    const entries = Array.from(byCollections.entries())
    for (let i = 0; i < entries.length; i++) {
        const [c, uris] = entries[i]

        await getDeleteProcessor(ctx, c).processInBatches(uris)
    }
}