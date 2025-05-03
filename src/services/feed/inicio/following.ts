import {SessionAgent} from "#/utils/session-agent";
import {getFollowing} from "#/services/user/users";
import {AppContext} from "#/index";
import {FeedPipelineProps, FeedSkeleton} from "#/services/feed/feed";
import {
    rootCreationDateSortKey
} from "#/services/feed/utils";
import {FeedViewPost, isFeedViewPost, SkeletonFeedPost} from "#/lex-api/types/app/bsky/feed/defs";
import {articleCollections, getCollectionFromUri, getDidFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri";
import {listOrderDesc, sortByKey, unique} from "#/utils/arrays";
import {FeedViewContent, isFeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {isKnownContent} from "#/utils/type-utils";
import {isPostView as isCAPostView} from "#/lex-server/types/ar/cabildoabierto/feed/defs";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post";

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


function getParentUriFromPost(e: FeedViewPost | FeedViewContent): string | null {
    if(!e.reply){
        return null
    } else if(e.reply.parent){
        return "uri" in e.reply.parent ? e.reply.parent.uri : null
    } else {
        return null
    }
}


function getRootUriFromPost(e: FeedViewPost | FeedViewContent): string | null {
    if(!e.reply){
        if(isFeedViewPost(e)){
            return e.post.uri
        } else if(isFeedViewContent(e) && isKnownContent(e.content)){
            return e.content.uri
        } else {
            // console.log("Warning: No se encontró el root del post", e)
            return null
        }
    } else if(e.reply.root && "uri" in e.reply.root){
        return e.reply.root.uri
    } else if(e.reply.parent && "uri" in e.reply.parent){
        return e.reply.parent.uri
    } else {
        // console.log("Warning: No se encontró el root del post", e)
        return null
    }
}


export const feedViewPostToSkeletonElement = (p: FeedViewPost): SkeletonFeedPost => {

    return {
        post: p.post.uri,
        reason: p.reason,
        $type: "app.bsky.feed.defs#skeletonFeedPost"
    }
}


export const getSkeletonFromTimeline = (timeline: FeedViewPost[], sameAuthorOnly: boolean = true) => {
    // Idea:
    // Me quedo con todos los posts cuyo root sea seguido por el agent
    // Si un root está más de una vez, me quedo solo con los que tengan respuestas únicamente del mismo autor,
    // y de esos con el que más respuestas tenga

    let skeleton: FeedSkeleton = timeline.map(feedViewPostToSkeletonElement)

    return skeleton
}


export const getFollowingFeedSkeleton = async (ctx: AppContext, agent: SessionAgent): Promise<FeedSkeleton> => {
    const following = [agent.did, ...(await getFollowing(ctx, agent.did))]

    const timelineQuery = agent.bsky.getTimeline({limit: 50})

    const articlesQuery = ctx.db.record.findMany({
        select: {
            createdAt: true,
            uri: true
        },
        where: {
            authorId: {
                in: following
            },
            collection: {
                in: articleCollections
            }
        },
        take: 10
    })

    const articleRepostsQuery: Promise<RepostQueryResult[]> = ctx.db.record.findMany({
        select: {
            createdAt: true,
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
            }
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
        },
        take: 10
    }) as Promise<RepostQueryResult[]>

    let [timeline, articles, articleReposts] = await Promise.all([timelineQuery, articlesQuery, articleRepostsQuery])

    // borramos todos los artículos y reposts de artículos posteriores al último post de la timeline
    const lastInTimeline = timeline.data.feed.length > 0 ? timeline.data.feed[timeline.data.feed.length-1].post.indexedAt : null
    if(lastInTimeline){
        const lastInTimelineDate = new Date(lastInTimeline)
        articles = articles.filter(a => a.createdAt >= lastInTimelineDate)
        articleReposts = articleReposts.filter(a => a.createdAt >= lastInTimelineDate)
    }

    const timelineSkeleton = getSkeletonFromTimeline(timeline.data.feed)

    const articleRepostsSkeleton = articleReposts.map(skeletonFromArticleReposts)

    return [
        ...timelineSkeleton,
        ...articles.map(a => ({post: a.uri})),
        ...articleRepostsSkeleton
    ]
}


export function filterFeed(feed: FeedViewContent[]){

    feed = feed.filter(a => {
        if(!isCAPostView(a.content)) return true
        const record = a.content.record as PostRecord

        if(!record.reply) return true

        const parent = getCollectionFromUri(record.reply.parent.uri)
        const root = getCollectionFromUri(record.reply.root.uri)

        if(!isArticle(parent) && !isPost(parent) && !isTopicVersion(parent)) return false
        if(!isArticle(root) && !isPost(root) && !isTopicVersion(root)) return false

        return true
    })

    let roots = new Set<string>()
    const res: FeedViewContent[] = []
    feed.forEach(a => {
        const rootUri = getRootUriFromPost(a)
        if(rootUri && !roots.has(rootUri)){
            res.push(a)
            roots.add(rootUri)
        }
    })

    return res
}


export const followingFeedPipeline: FeedPipelineProps = {
    getSkeleton: getFollowingFeedSkeleton,
    sortKey: rootCreationDateSortKey,
    filter: filterFeed
}