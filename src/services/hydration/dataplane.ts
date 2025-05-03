import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {PostView as BskyPostView} from "#/lex-server/types/app/bsky/feed/defs";
import {Collection, FeedEngagementProps} from "#/lib/types";
import {ProfileViewBasic} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {TopicView} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {
    ArticleViewForSelectionQuote, getArticleViewsForSelectionQuotes,
    getBskyPosts,
    getCAFeedContents,
    getTopicViews
} from "#/services/hydration/hydrate";
import {FeedSkeleton} from "#/services/feed/feed";
import {getUserEngagement} from "#/services/feed/get-user-engagement";
import {PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {unique} from "#/utils/arrays";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post";


export type FeedElementQueryResult = {
    uri: string
    cid: string
    rkey: string
    collection: Collection
    createdAt: Date,
    record: string | null
    author: {
        did: string
        handle: string | null
        displayName: string | null
        avatar: string | null
        CAProfileUri: string | null
    }
    _count: {
        likes: number
        reposts: number
        replies: number
    }
    uniqueViewsCount: number | null
    content: {
        text: string | null
        summary?: string
        textBlob: {
            cid: string
        } | null
        format: string | null
        post: {
            quote: string | null
            embed: string | null
            facets: string | null
            replyTo: {
                uri: string
                cid: string | null
                author: {
                    did: string
                    handle: string | null
                    displayName: string | null
                }
            } | null
            root: {
                uri: string
                cid: string | null
                author: {
                    did: string
                    handle: string | null
                    displayName: string | null
                }
            } | null
        } | null,
        article: {
            title: string
        } | null
    } | null
    enDiscusion: boolean | null
}


function joinMaps<T>(a?: Map<string, T>, b?: Map<string, T>): Map<string, T> {
    return new Map([...a ?? [], ...b ?? []])
}

function joinLists<T>(a?: T[], b?: T[]): T[] {
    return [...a ?? [], ...b ?? []]
}


export function joinHydrationData(a: HydrationData, b: HydrationData): HydrationData {
    return {
        caContents: joinMaps(a.caContents, b.caContents),
        bskyPosts: joinMaps(a.bskyPosts, b.bskyPosts),
        engagement: {
            likes: joinLists(a.engagement?.likes, b.engagement?.likes),
            reposts: joinLists(a.engagement?.reposts, b.engagement?.reposts)
        },
        bskyUsers: joinMaps(a.bskyUsers, b.bskyUsers),
        caUsers: joinMaps(a.caUsers, b.caUsers),
        topicViews: joinMaps(a.topicViews, b.topicViews),
        articleViewsForSelectionQuotes: joinMaps(a.articleViewsForSelectionQuotes, b.articleViewsForSelectionQuotes)
    }
}


function getReplyUrisFromPostViews(postViews: (PostView | BskyPostView)[]) {
    return unique(postViews.reduce((acc: string[], cur) => {
        const record = cur.record as PostRecord
        if (record.reply) {
            return [...acc, cur.uri, record.reply.root.uri, record.reply.parent.uri]
        } else {
            return [...acc, cur.uri]
        }
    }, []))
}


export type HydrationData = {
    caContents?: Map<string, FeedElementQueryResult>
    bskyPosts?: Map<string, BskyPostView>
    engagement?: FeedEngagementProps
    bskyUsers?: Map<string, ProfileViewBasic>
    caUsers?: Map<string, CAProfileViewBasic>
    topicViews?: Map<string, TopicView>
    articleViewsForSelectionQuotes?: Map<string, ArticleViewForSelectionQuote>
}


export class Dataplane {
    ctx: AppContext
    agent: SessionAgent
    data: HydrationData

    constructor(ctx: AppContext, agent: SessionAgent) {
        this.ctx = ctx
        this.agent = agent
        this.data = {}
    }

    async fetchHydrationData(skeleton: FeedSkeleton) {
        const uris = skeleton.map(p => p.post)

        const bskyPostsMap = await getBskyPosts(this.agent, uris)

        const replyUris = getReplyUrisFromPostViews(Array.from(bskyPostsMap.values()))

        const [bskyRepliesMap, caContents, engagement, topicViews, articleViewsForSelectionQuotes] = await Promise.all([
            getBskyPosts(this.agent, replyUris),
            getCAFeedContents(this.ctx, uris),
            getUserEngagement(this.ctx, uris, this.agent.did),
            getTopicViews(this.ctx, this.agent, replyUris),
            getArticleViewsForSelectionQuotes(this.ctx, this.agent, replyUris)
        ])

        let bskyMap = new Map([...bskyPostsMap, ...bskyRepliesMap])

        this.data = {
            caContents,
            bskyPosts: bskyMap,
            engagement,
            topicViews,
            articleViewsForSelectionQuotes
        }
    }
}