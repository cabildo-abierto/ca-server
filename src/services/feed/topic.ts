import {FeedViewContent, isFeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {CAHandlerNoAuth} from "#/utils/handler";
import {FeedSkeleton, getFeed} from "#/services/feed/feed";
import {AppContext} from "#/index";
import {Agent} from "#/utils/session-agent";
import {creationDateSortKey} from "#/services/feed/utils";
import {hydrateFeedViewContent} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {isNotFoundPost} from "#/lex-server/types/app/bsky/feed/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";


const getTopicRepliesSkeleton = async (ctx: AppContext, id: string) => {
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


const getTopicMentionsSkeleton = async (ctx: AppContext, agent: Agent, data: Dataplane, id: string): Promise<FeedSkeleton> => {
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
        },
        take: 25
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


export const getTopicVersionReplies = async (ctx: AppContext, agent: Agent, id: string): Promise<{data?: FeedViewContent[], error?: string}> => {
    const skeleton = await getTopicRepliesSkeleton(ctx, id)

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


export const getTopicFeed: CAHandlerNoAuth<{ query: { i?: string, did?: string, rkey?: string } }, {
    mentions: FeedViewContent[],
    replies: FeedViewContent[],
    topics: string[]
}> = async (ctx, agent, {query}) => {
    let {i: id, did, rkey} = query
    if(!id){
        if(!did || !rkey){
            return {error: "Se requiere un id o un par did y rkey."}
        } else {
            id = await getTopicIdFromTopicVersionUri(ctx.db, did, rkey) ?? undefined
            if(!id){
                return {error: "No se encontró esta versión del tema."}
            }
        }
    }

    try {
        const [replies, mentions, topicMentions] = await Promise.all([
            getTopicVersionReplies(ctx, agent, id),
            getFeed({
                ctx,
                agent,
                pipeline: {
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