import {
    FeedViewPost
} from "@atproto/api/src/client/types/app/bsky/feed/defs";
import {addCounters} from "#/utils/utils";
import {FeedViewContent} from "#/lexicon-api/types/ar/cabildoabierto/feed/defs";
import {SkeletonFeedPost} from "#/lexicon-server/types/app/bsky/feed/defs";


export type FeedEngagementProps = {
    likes: {likedRecordId: string | null; uri: string}[]
    reposts: {repostedRecordId: string | null; uri: string}[]
}


export function addCountersToFeed(feed: any[], engagement: FeedEngagementProps): FeedViewContent[] {
    return feed.map((elem) => {
        return addCounters(elem, engagement)
    })
}


function getRootCreationDate(p: FeedViewContent): Date | null {
    if(p.reason && "indexedAt" in p.reason){
        return new Date(p.reason.indexedAt)
    } else if(p.content.$type == "app.bsky.feed.defs#postView"){
        if(p.reply && p.reply.root && "indexedAt" in p.reply.root){
            return new Date(p.reply.root.indexedAt)
        } else if(p.reply && p.reply.parent && "indexedAt" in p.reply.parent){
            return new Date(p.reply.parent.indexedAt)
        }
    }
    if("indexedAt" in p.content){
        return new Date(p.content.indexedAt)
    }
    return null
}


export const rootCreationDateSortKey = (a: FeedViewContent) => {
    const date = getRootCreationDate(a)
    return date ? [date.getTime()] : [0]
}
