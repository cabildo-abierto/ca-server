import {SessionAgent} from "#/utils/session-agent";
import {getFollowing} from "#/services/user/users";
import {AppContext} from "#/index";
import {FeedPipelineProps, FeedSkeleton, GetSkeletonProps} from "#/services/feed/feed";
import {
    rootCreationDateSortKey
} from "#/services/feed/utils";
import {
    FeedViewPost,
    isFeedViewPost,
    isReasonRepost,
    SkeletonFeedPost
} from "#/lex-api/types/app/bsky/feed/defs";
import {articleCollections, getCollectionFromUri, getDidFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri";
import {FeedViewContent, isFeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {isKnownContent} from "#/utils/type-utils";
import {isPostView as isCAPostView} from "#/lex-server/types/ar/cabildoabierto/feed/defs";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post";
import {Dataplane} from "#/services/hydration/dataplane";
import {logTimes} from "#/utils/utils";
import {$Typed} from "@atproto/api";

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


function getRootUriFromPost(e: FeedViewPost | FeedViewContent): string | null {
    if (!e.reply) {
        if (isFeedViewPost(e)) {
            return e.post.uri
        } else if (isFeedViewContent(e) && isKnownContent(e.content)) {
            return e.content.uri
        } else {
            console.log("Warning: No se encontró el root del post", e)
            return null
        }
    } else if (e.reply.root && "uri" in e.reply.root) {
        return e.reply.root.uri
    } else if (e.reply.parent && "uri" in e.reply.parent) {
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


export const getSkeletonFromTimeline = (timeline: FeedViewPost[], following?: string[]) => {
    // Idea:
    // Me quedo con todos los posts cuyo root sea seguido por el agent
    // Si un root está más de una vez, me quedo solo con los que tengan respuestas únicamente del mismo autor,
    // y de esos con el que más respuestas tenga

    let filtered = following ? timeline.filter(t => {
        if (t.reason && isReasonRepost(t.reason)) return true
        const rootUri = getRootUriFromPost(t)
        if (!rootUri) return false
        const rootAuthor = getDidFromUri(rootUri)
        return following.includes(rootAuthor)
    }) : timeline

    let skeleton: FeedSkeleton = filtered.map(feedViewPostToSkeletonElement)


    return skeleton
}


export async function getArticlesForFollowingFeed(ctx: AppContext, following: string[]): Promise<{
    createdAt: Date,
    uri: string
}[]> {
    const t1 = Date.now()
    const res = await ctx.db.record.findMany({
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
    const t2 = Date.now()
    // logTimes("getArticlesForFollowingFeed", [t1, t2])
    return res
}


export async function getArticleRepostsForFollowingFeed(ctx: AppContext, following: string[]) {
    const t1 = Date.now()
    const res = await (ctx.db.record.findMany({
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
    }) as Promise<RepostQueryResult[]>)
    const t2 = Date.now()
    // logTimes("getArticleRepostsForFollowingFeed", [t1, t2])
    return res
}


export async function getBskyTimeline(agent: SessionAgent, limit: number, data: Dataplane, cursor?: string): Promise<{
    feed: $Typed<FeedViewPost>[],
    cursor: string | undefined
}> {
    const t1 = Date.now()
    const res = await agent.bsky.getTimeline({limit, cursor})
    const t2 = Date.now()
    // logTimes("getBskyTimeline", [t1, t2])

    const newCursor = res.data.cursor

    const feed = res.data.feed
    data.storeFeedViewPosts(feed)

    return {
        feed: feed.map(f => ({
            ...f,
            $type: "app.bsky.feed.defs#feedViewPost",
        })),
        cursor: newCursor
    }
}


export const getFollowingFeedSkeleton: GetSkeletonProps = async (ctx, agent, data, cursor) => {
    const following = [agent.did, ...(await getFollowing(ctx, agent.did))]

    const timelineQuery = getBskyTimeline(agent, 25, data, cursor)

    const articlesQuery = getArticlesForFollowingFeed(ctx, following)

    const articleRepostsQuery: Promise<RepostQueryResult[]> = getArticleRepostsForFollowingFeed(ctx, following)

    let [timeline, articles, articleReposts] = await Promise.all([timelineQuery, articlesQuery, articleRepostsQuery])

    // borramos todos los artículos y reposts de artículos posteriores al último post de la timeline
    const lastInTimeline = timeline.feed.length > 0 ? timeline.feed[timeline.feed.length - 1].post.indexedAt : null
    if (lastInTimeline) {
        const lastInTimelineDate = new Date(lastInTimeline)
        articles = articles.filter(a => a.createdAt >= lastInTimelineDate)
        articleReposts = articleReposts.filter(a => a.createdAt >= lastInTimelineDate)
    }

    const timelineSkeleton = getSkeletonFromTimeline(timeline.feed, following)

    const articleRepostsSkeleton = articleReposts.map(skeletonFromArticleReposts)

    return {
        skeleton: [
            ...timelineSkeleton,
            ...articles.map(a => ({post: a.uri})),
            ...articleRepostsSkeleton
        ],
        cursor: timeline.cursor
    }
}


export function filterFeed(feed: FeedViewContent[], allowTopicVersions: boolean = false) {

    feed = feed.filter(a => {
        if (!isCAPostView(a.content)) return true
        const record = a.content.record as PostRecord

        if (!record.reply) return true

        const parent = getCollectionFromUri(record.reply.parent.uri)
        const root = getCollectionFromUri(record.reply.root.uri)

        const badParent = !isArticle(parent) && !isPost(parent) && (!allowTopicVersions || !isTopicVersion(parent))
        const badRoot = !isArticle(root) && !isPost(root) && (!allowTopicVersions || !isTopicVersion(root))
        return !badParent && !badRoot
    })

    let roots = new Set<string>()
    const res: FeedViewContent[] = []
    feed.forEach(a => {
        const rootUri = getRootUriFromPost(a)
        if (rootUri && !roots.has(rootUri)) {
            res.push(a)
            roots.add(rootUri)
        } else if (!rootUri) {
            console.log("Warning: Filtrando porque no se encontró el root.")
        }
    })

    return res
}


export const followingFeedPipeline: FeedPipelineProps = {
    getSkeleton: getFollowingFeedSkeleton,
    sortKey: rootCreationDateSortKey,
    filter: filterFeed
}