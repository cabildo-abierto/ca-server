import {FeedViewContent, isFeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {CAHandler} from "#/utils/handler";
import {FeedSkeleton, getFeed} from "#/services/feed/feed";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {creationDateSortKey} from "#/services/feed/utils";
import {hydrateFeedViewContent} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {isNotFoundPost} from "#/lex-server/types/app/bsky/feed/defs";
import {Dataplane} from "#/services/hydration/dataplane";


const getTopicRepliesSkeleton = async (ctx: AppContext, agent: SessionAgent, id: string) => {
    const replies = await ctx.db.record.findMany({
        select: {uri: true},
        where: {
            OR: [
                {
                    content: {
                        post: {
                            replyTo: {
                                collection: {
                                    in: ["ar.com.cabildoabierto.topic", "ar.cabildoabierto.wiki.topicVersion"]
                                },
                                content: {
                                    topicVersion: {
                                        topicId: id
                                    }
                                }
                            }
                        }
                    }
                },
            ]
        },
        orderBy: {
            createdAt: "desc"
        }
    })
    return replies.map(r => ({post: r.uri}))
}


const getTopicMentionsSkeleton = async (ctx: AppContext, agent: SessionAgent, data: Dataplane, id: string): Promise<FeedSkeleton> => {
    const mentions = await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            content: {
                references: {
                    some: {
                        referencedTopicId: id
                    }
                }
            },
            collection: {
                in: [
                    "ar.com.cabildoabierto.article",
                    "app.bsky.feed.post",
                    "ar.cabildoabierto.feed.article"
                ]
            }
        },
        orderBy: {
            createdAt: "desc"
        }
    })
    return mentions.map(r => ({post: r.uri}))
}


// TO DO: Solo mostrar versiones actuales.
export async function getTopicMentionsInTopics(ctx: AppContext, id: string){
    return ctx.db.content.findMany({
        select: {
            topicVersion: {
                select: {
                    topicId: true
                }
            }
        },
        where: {
            references: {
                some: {
                    referencedTopicId: id
                }
            },
            record: {
                collection: "ar.com.cabildoabierto.topic"
            }
        }
    })
}


export const getTopicVersionReplies = async (ctx: AppContext, agent: SessionAgent, id: string): Promise<{data?: FeedViewContent[], error?: string}> => {
    const skeleton = await getTopicRepliesSkeleton(ctx, agent, id)

    const data = new Dataplane(ctx, agent)
    await data.fetchFeedHydrationData(skeleton)

    let feed = skeleton
        .map((e) => (hydrateFeedViewContent(e, data)))

    feed.filter(isNotFoundPost).forEach(x => {
        console.log("Content not found:", x.uri)
    })

    let res = feed
        .filter(x => isFeedViewContent(x))

    res = sortByKey(res, creationDateSortKey, listOrderDesc)

    return {data: res}
}


export const getTopicFeed: CAHandler<{ params: { id: string } }, {
    mentions: FeedViewContent[],
    replies: FeedViewContent[],
    topics: string[]
}> = async (ctx, agent, {params}) => {
    let {id} = params

    try {
        const [replies, mentions, topicMentions] = await Promise.all([
            getTopicVersionReplies(ctx, agent, id),
            getFeed({
                ctx, agent, pipeline: {
                    getSkeleton: async (ctx, agent, data, cursor) => ({skeleton: await getTopicMentionsSkeleton(ctx, agent, data, id), cursor: undefined}),
                    sortKey: creationDateSortKey
                }
            }),
            getTopicMentionsInTopics(ctx, id)
        ])

        if(!mentions.data) return {error: mentions.error}
        if(!replies.data) return {error: replies.error}
        return {
            data: {
                mentions: mentions.data.feed,
                replies: replies.data,
                topics: topicMentions.map(t => t.topicVersion?.topicId).filter(x => x != null)
            }
        }
    } catch (e) {
        console.error("Error getting topic feed for", id)
        console.error(e)
        return {error: "Ocurrió un error al obtener el feed del tema " + id}
    }
}