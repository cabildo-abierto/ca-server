import {SessionAgent} from "#/utils/session-agent";
import {getFollowing} from "#/services/user/users";
import {AppContext} from "#/index";
import {FeedPipelineProps, FeedSkeleton} from "#/services/feed/feed";
import {
    rootCreationDateSortKey
} from "#/services/feed/utils";
import {FeedViewPost, SkeletonFeedPost} from "#/lexicon-api/types/app/bsky/feed/defs";
import {articleCollections, getDidFromUri} from "#/utils/uri";
import {isPostView} from "#/lexicon-server/types/app/bsky/feed/defs";
import {unique} from "#/utils/arrays";

type RepostQueryResult = {
    author: {
        did: string,
        handle: string | null,
        displayName: string | null
    },
    createdAt: Date
    repost: {
        repostedRecord: {
            uri: string
            lastInThreadId: string | null
            secondToLastInThreadId: string | null
        }
    }
}


function skeletonFromArticleReposts(p: RepostQueryResult): SkeletonFeedPost {
    return {
        $type: "app.bsky.feed.defs#skeletonFeedPost",
        post: p.repost.repostedRecord.uri,
        reason: {
            $type: "app.bsky.feed.defs#skeletonReasonRepost"
        }
    }
}


export function filterTimeline(e: FeedViewPost){
    if(e.reason) return true
    const rootUri = getRootUriFromPost(e)
    const parentUri = getParentUriFromPost(e)

    if(rootUri){
        const rootAuthor = getDidFromUri(rootUri)
        if(rootAuthor != e.post.author.did) return false
    }
    if(parentUri){
        const parentAuthor = getDidFromUri(parentUri)
        if(parentAuthor != e.post.author.did) return false
    }

    return true
}


function getParentUriFromPost(e: FeedViewPost): string | null {
    if(!e.reply){
        return null
    } else if(e.reply.parent){
        return "uri" in e.reply.parent ? e.reply.parent.uri : null
    } else {
        return null
    }
}


function getRootUriFromPost(e: FeedViewPost): string | null {
    if(!e.reply){
        return e.post.uri
    } else if(e.reply.root){
        return "uri" in e.reply.root ? e.reply.root.uri : null
    } else if(e.reply.parent){
        return "uri" in e.reply.parent ? e.reply.parent.uri : null
    } else {
        return null
    }
}


const getSkeletonFromTimeline = (timeline: FeedViewPost[]) => {
    // remove posts with root or parent different than author
    timeline = timeline.filter(filterTimeline)

    // remove posts with same root
    timeline = unique(timeline, getRootUriFromPost, true)

    let skeleton: FeedSkeleton = timeline.map(p => ({
        post: p.post.uri,
        reason: p.reason,
        $type: "app.bsky.feed.defs#skeletonFeedPost"
    }))

    return skeleton
}


export const getFollowingFeedSkeleton = async (ctx: AppContext, agent: SessionAgent): Promise<FeedSkeleton> => {
    const following = [agent.did, ...(await getFollowing(ctx, agent.did))]

    const timelineQuery = agent.bsky.getTimeline({limit: 50})

    const articlesQuery = ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            authorId: {
                in: following
            },
            collection: {
                in: articleCollections
            }
        }
    }).then(x => x.map(a => ({post: a.uri})))

    const articleRepostsQuery: Promise<RepostQueryResult[]> = ctx.db.record.findMany({
        select: {
            author: {
                select: {
                    did: true,
                    displayName: true,
                    handle: true
                }
            },
            repost: {
                select: {
                    repostedRecord: {
                        select: {
                            uri: true,
                            lastInThreadId: true,
                            secondToLastInThreadId: true
                        }
                    },
                }
            },
            createdAt: true
        },
        where: {
            authorId: {
                in: following
            },
            collection: "app.bsky.feed.repost",
            repost: {
                repostedRecord: {
                    collection: "ar.com.cabildoabierto.article"
                }
            }
        }
    }) as Promise<RepostQueryResult[]>

    const [timeline, articles, articleReposts] = await Promise.all([timelineQuery, articlesQuery, articleRepostsQuery])

    const timelineSkeleton = getSkeletonFromTimeline(timeline.data.feed)
    const articleRepostsSkeleton = articleReposts.map(skeletonFromArticleReposts)

    return [
        ...timelineSkeleton,
        ...articles,
        ...articleRepostsSkeleton
    ]
}


export const followingFeedPipeline: FeedPipelineProps = {
    getSkeleton: getFollowingFeedSkeleton,
    sortKey: rootCreationDateSortKey
}