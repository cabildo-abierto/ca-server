import {FeedViewContent, isFeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {FeedSkeleton, getFeed, GetSkeletonProps} from "#/services/feed/feed";
import {AppContext} from "#/index";
import {Agent} from "#/utils/session-agent";
import {creationDateSortKey} from "#/services/feed/utils";
import {hydrateFeedViewContent} from "#/services/hydration/hydrate";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {isNotFoundPost} from "#/lex-server/types/app/bsky/feed/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version";
import {getTopicTitle} from "#/services/wiki/utils";
import {
    TopicProp,
} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {getUri} from "#/utils/uri";
import {isPostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {
    isView as isSelectionQuoteEmbed
} from "#/lex-api/types/ar/cabildoabierto/embed/selectionQuote"


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


const getTopicMentionsSkeleton = async (
    ctx: AppContext,
    agent: Agent,
    data: Dataplane,
    id: string,
    cursor: string | undefined
): Promise<{skeleton: FeedSkeleton, cursor: string | undefined}> => {

    const collections = [
        "app.bsky.feed.post",
        "ar.cabildoabierto.feed.article"
    ]

    const offset = cursor ? parseInt(cursor) : 0
    const limit = 25

    const mentions = await ctx.kysely
        .selectFrom("Record")
        .select(["Record.uri"])
        .innerJoin("Reference", "Reference.referencingContentId", "Record.uri")
        .leftJoin("Post", "Post.uri", "Record.uri")
        .leftJoin("TopicVersion", "TopicVersion.uri", "Post.rootId")
        .where("Reference.referencedTopicId", "=", id)
        .where("Record.collection", "in", collections)
        .where(eb => eb.or([
            eb("TopicVersion.topicId", "!=", id),
            eb("TopicVersion.uri", "is", null)
        ]))
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute()

    return {
        skeleton: mentions.map(r => ({post: r.uri})),
        cursor: (offset + limit).toString()
    }
}


export async function getTopicMentionsInTopics(ctx: AppContext, id: string){
    const topics = await ctx.kysely
        .selectFrom("TopicVersion")
        .innerJoin("Record", "Record.uri", "TopicVersion.uri")
        .where("Record.collection", "=", "ar.cabildoabierto.wiki.topicVersion")
        .select("topicId")
        .where(eb => eb.exists(eb => eb
            .selectFrom("Reference")
            .where("Reference.referencedTopicId", "=", id)
            .whereRef("Reference.referencingContentId", "=", "TopicVersion.uri")
        ))
        .innerJoin("Topic", "Topic.currentVersionId", "TopicVersion.uri")
        .select(["TopicVersion.topicId", "TopicVersion.props"])
        .orderBy("created_at", "desc")
        .limit(25)
        .execute()

    return topics.map(t => {
        return {
            id: t.topicId,
            title: getTopicTitle({id: t.topicId, props: t.props as TopicProp[]})
        }
    })
}


async function hydrateRepliesSkeleton(ctx: AppContext, agent: Agent, skeleton: FeedSkeleton){
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

    return res
}


export const getTopicVersionReplies = async (ctx: AppContext, agent: Agent, id: string): Promise<{data?: FeedViewContent[], error?: string}> => {
    const skeleton = await getTopicRepliesSkeleton(ctx, id)
    const res = await hydrateRepliesSkeleton(ctx, agent, skeleton)

    return {data: res}
}


export const getTopicFeed: CAHandlerNoAuth<{ params: {kind: "mentions" | "discussion"}, query: { i?: string, did?: string, rkey?: string, cursor?: string } }, {
    feed: FeedViewContent[],
    cursor?: string
}> = async (ctx, agent, {query, params}) => {
    let {i: id, did, rkey, cursor} = query
    const {kind} = params

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

    if(kind == "discussion"){
        const replies = await getTopicVersionReplies(ctx, agent, id)
        if(!replies.data) return {error: replies.error}

        return {
            data: {
                feed: replies.data,
                cursor: undefined
            }
        }
    } else if(kind == "mentions"){

        const getSkeleton: GetSkeletonProps = async (ctx, agent, data, cursor) => {
            return await getTopicMentionsSkeleton(ctx, agent, data, id, cursor)
        }

        const mentions = await getFeed({
            ctx,
            agent,
            pipeline: {
                getSkeleton,
                sortKey: creationDateSortKey
            },
            cursor
        })

        return {
            data: mentions.data
        }
    } else {
        return {error: "Solicitud inválida."}
    }
}


export const getTopicMentionsInTopicsFeed: CAHandler<{ query: { i?: string, did?: string, rkey?: string } }, {
    topics: {id: string, title: string}[],
    cursor: string | undefined
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

    const topicMentions = await getTopicMentionsInTopics(ctx, id)

    return {
        data: {
            topics: topicMentions,
            cursor: undefined
        }
    }
}


export const getTopicQuoteReplies: CAHandler<{params: {did: string, rkey: string}}, PostView[]> = async (ctx, agent, {params}) => {
    const {did, rkey} = params
    const uri = getUri(did, "ar.cabildoabierto.wiki.topicVersion", rkey)

    const skeleton = (await ctx.kysely
        .selectFrom("Post")
        .where("Post.replyToId", "=", uri)
        .select("uri")
        .execute()).map(p => ({post: p.uri}))

    const hydrated = await hydrateRepliesSkeleton(ctx, agent, skeleton)

    const posts: PostView[] = hydrated
        .map(c => c.content)
        .filter(c => isPostView(c))
        .filter(c => isSelectionQuoteEmbed(c.embed))

    return {
        data: posts
    }
}