import {addCountersToFeed, FeedEngagementProps} from "#/services/feed/utils";
import {AppContext} from "#/index";
import {FeedViewContent} from "#/lexicon-api/types/ar/cabildoabierto/feed/defs";


export async function getUserEngagement(ctx: AppContext, uris: string[], did: string): Promise<FeedEngagementProps> {

    const getLikes = ctx.db.like.findMany({
        select: {
            likedRecordId: true,
            uri: true
        },
        where: {
            record: {
                authorId: did
            },
            likedRecordId: {
                in: uris
            }
        }
    })

    const getReposts = ctx.db.repost.findMany({
        select: {
            repostedRecordId: true,
            uri: true
        },
        where: {
            record: {
                authorId: did
            },
            repostedRecordId: {
                in: uris
            }
        }
    })

    const [likes, reposts] = await Promise.all([getLikes, getReposts])

    return {likes, reposts}
}


export async function addViewerEngagementToFeed(ctx: AppContext, viewerDid: string, feed: FeedViewContent[]) {
    const uris = feed.map(e => ("uri" in e.content ? e.content.uri : null)).filter(x => x != null)
    const engagement = await getUserEngagement(ctx, uris, viewerDid)

    return addCountersToFeed(feed, engagement)
}