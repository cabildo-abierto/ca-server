import {AppContext} from "#/index";
import {FeedContentProps} from "#/lib/types";


export async function getTopicFeed(ctx: AppContext, id: string, did: string): Promise<{feed?: {mentions: FeedContentProps[], replies: FeedContentProps[], topics: string[]}, error?: string}> {
    // TO DO
    return {feed: {mentions: [], replies: [], topics: []}}
    /*
    id = decodeURIComponent(id)

    try {

        const getReplies = ctx.db.record.findMany({
            select: threadRepliesQuery,
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

        const getMentions = ctx.db.record.findMany({
            select: {
                ...recordQuery,
                ...reactionsQuery,
                content: {
                    select: {
                        text: true,
                        textBlob: true,
                        article: {
                            select: {
                                title: true
                            }
                        },
                        post: {
                            select: {
                                facets: true,
                                embed: true,
                                quote: true,
                                replyTo: {
                                    select: {
                                        uri: true,
                                        author: {
                                            select: {
                                                did: true,
                                                handle: true,
                                                displayName: true
                                            }
                                        }
                                    }
                                },
                                root: {
                                    select: {
                                        uri: true,
                                        author: {
                                            select: {
                                                did: true,
                                                handle: true,
                                                displayName: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
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

        // TO DO: Solo mostrar versiones actuales.
        const getTopicMentions = ctx.db.content.findMany({
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

        const [replies, mentions, topicMentions] = await Promise.all([getReplies, getMentions, getTopicMentions])

        const repliesEngagement = await getUserEngagement(replies, did)
        const mentionsEngagement = await getUserEngagement(mentions, did)
        const readyForFeedMentions = addCountersToFeed(mentions, mentionsEngagement)
        const readyForFeedReplies = addCountersToFeed(replies, repliesEngagement)

        return {
            feed: {
                mentions: readyForFeedMentions,
                replies: readyForFeedReplies,
                topics: topicMentions.map(t => t.topicVersion.topicId)
            }
        }
    } catch (e) {
        console.error("Error getting topic feed for", id)
        console.error(e)
        return {error: "Ocurrió un error al obtener el feed del tema " + id}
    }
    */
}