import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {CAHandler} from "#/utils/handler";
import {getFeed} from "#/services/feed/feed";
import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {creationDateSortKey} from "#/services/feed/utils";


const getTopicRepliesSkeleton = async (ctx: AppContext, agent: SessionAgent, id: string) => {
    const replies = await ctx.db.record.findMany({
        select: {uri: true},
        where: {
            OR: [
                {
                    content: {
                        post: {
                            replyTo: {
                                collection: "ar.com.cabildoabierto.topic",
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


const getTopicMentionsSkeleton = async (ctx: AppContext, agent: SessionAgent, id: string) => {
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
                in: ["ar.com.cabildoabierto.article", "ar.com.cabildoabierto.quotePost", "app.bsky.feed.post"]
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


export const getTopicFeed: CAHandler<{ params: { id: string } }, {
    mentions: FeedViewContent[],
    replies: FeedViewContent[],
    topics: string[]
}> = async (ctx, agent, {params}) => {
    let {id} = params

    try {
        const [replies, mentions, topicMentions] = await Promise.all([
            getFeed({
                ctx, agent, pipeline: {
                    getSkeleton: (ctx, agent) => getTopicRepliesSkeleton(ctx, agent, id),
                    sortKey: creationDateSortKey
                }
            }),
            getFeed({
                ctx, agent, pipeline: {
                    getSkeleton: (ctx, agent) => getTopicMentionsSkeleton(ctx, agent, id),
                    sortKey: creationDateSortKey
                }
            }),
            getTopicMentionsInTopics(ctx, id)
        ])

        if(!mentions.data) return {error: mentions.error}
        if(!replies.data) return {error: replies.error}
        return {
            data: {
                mentions: mentions.data,
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