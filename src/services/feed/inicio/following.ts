import {Agent, SessionAgent} from "#/utils/session-agent";
import {getFollowing} from "#/services/user/users";
import {AppContext} from "#/index";
import {FeedPipelineProps, FeedSkeleton, FollowingFeedFilter, GetSkeletonProps} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";
import {FeedViewPost, isFeedViewPost, isReasonRepost, SkeletonFeedPost} from "#/lex-api/types/app/bsky/feed/defs";
import {articleCollections, getCollectionFromUri, getDidFromUri, isArticle, isPost, isTopicVersion} from "#/utils/uri";
import {FeedViewContent, isFeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {isKnownContent} from "#/utils/type-utils";
import {isPostView as isCAPostView} from "#/lex-server/types/ar/cabildoabierto/feed/defs";
import {Record as PostRecord} from "#/lex-server/types/app/bsky/feed/post";
import {Dataplane} from "#/services/hydration/dataplane";
import {$Typed} from "@atproto/api";
import {isTopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {FeedFormatOption} from "#/services/feed/inicio/discusion";
import {logTimes} from "#/utils/utils";

export type RepostQueryResult = {
    uri?: string
    createdAt: Date | null
    reaction: {
        subjectId: string | null
    } | null
}


function skeletonFromArticleReposts(p: RepostQueryResult): SkeletonFeedPost | null {
    if (p.reaction && p.reaction.subjectId) {
        return {
            $type: "app.bsky.feed.defs#skeletonFeedPost",
            post: p.reaction.subjectId,
            reason: {
                $type: "app.bsky.feed.defs#skeletonReasonRepost",
                repost: p.uri
            }
        }
    }
    return null
}


function getRootUriFromPost(e: FeedViewPost | FeedViewContent): string | null {
    if (!e.reply) {
        if (isFeedViewPost(e)) {
            return e.post.uri
        } else if (isFeedViewContent(e) && isKnownContent(e.content)) {
            return e.content.uri
        } else {
            console.warn("Warning: No se encontró el root del post", e)
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


function getRootTopicIdFromPost(e: FeedViewPost | FeedViewContent): string | null {
    if (!e.reply) {
        if (isFeedViewPost(e)) {
            return e.post.uri
        } else if (isFeedViewContent(e) && isKnownContent(e.content)) {
            return e.content.uri
        } else {
            console.warn("Warning: No se encontró el root del post", e)
            return null
        }
    } else if (e.reply.root) {
        return isTopicViewBasic(e.reply.root) ? e.reply.root.id : null
    } else if (e.reply.parent) {
        return isTopicViewBasic(e.reply.parent) ? e.reply.parent.id : null
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
        if (!rootUri) {
            return false
        }
        const rootAuthor = getDidFromUri(rootUri)
        return following.includes(rootAuthor)
    }) : timeline

    let skeleton: FeedSkeleton = filtered.map(feedViewPostToSkeletonElement)


    return skeleton
}


export async function getArticlesForFollowingFeed(ctx: AppContext, agent: SessionAgent, data: Dataplane, startDate: Date): Promise<{
    created_at: Date,
    uri: string
}[]> {
    // quiero todos los artículos publicados por usuarios seguidos por agent.did

    const t1 = Date.now()
    const res = await ctx.kysely
        .selectFrom("Record")
        .select(["Record.created_at", "Record.uri"])
        .where("Record.collection", "in", articleCollections)
        .innerJoin("User", "User.did", "Record.authorId")
        .leftJoin("Follow", "Follow.userFollowedId", "User.did")
        .leftJoin("Record as FollowRecord", "FollowRecord.uri", "Follow.uri")
        .where(eb => eb.or([
            eb("FollowRecord.authorId", "=", agent.did),
            eb("Record.authorId", "=", agent.did)
        ]))
        .where("Record.created_at", "<", startDate)
        .orderBy("Record.created_at", "desc")
        .limit(25)
        .execute()
    const t2 = Date.now()
    logTimes("get articles", [t1, t2])
    return res
}


export async function getArticleRepostsForFollowingFeed(ctx: AppContext, agent: SessionAgent, dataplane: Dataplane, startDate: Date): Promise<RepostQueryResult[]> {
    const t1 = Date.now()
    const res = await ctx.kysely
        .selectFrom("Record")
        .innerJoin("Reaction", "Reaction.uri", "Record.uri")
        .innerJoin("Record as RepostedRecord", "RepostedRecord.uri", "Reaction.subjectId")
        .innerJoin("Follow", "Follow.userFollowedId", "Record.authorId")
        .innerJoin("Record as FollowRecord", "Follow.uri", "FollowRecord.uri")
        .select(["Record.uri as repostUri", "Record.created_at as repostCreatedAt", "RepostedRecord.uri as recordUri"])
        .where("Record.collection", "=", "app.bsky.feed.repost")
        .where("RepostedRecord.collection", "=", "ar.cabildoabierto.feed.article")
        .where("FollowRecord.authorId", "=", agent.did)
        .orderBy("Record.created_at", "desc")
        .execute()
    const t2 = Date.now()
    logTimes("get article reposts", [t1, t2])

    const qrs: RepostQueryResult[] = []
    res.forEach(r => {
        const qr = {
            reaction: {
                subjectId: r.recordUri
            },
            uri: r.repostUri,
            createdAt: r.repostCreatedAt,
        }
        qrs.push(qr)
        dataplane.reposts.set(r.recordUri, qr)
    })
    return qrs
}


async function retry<X, Y>(x: X, f: (params: X) => Promise<Y>, attempts: number, delay: number = 200): Promise<Y> {
    try {
        return await f(x)
    } catch (err) {
        if (attempts > 0) {
            console.log(`Retrying after error. Attempts remaining ${attempts - 1}. Error:`, err)
            await new Promise(r => setTimeout(r, delay))
            return retry(x, f, attempts - 1)
        } else {
            throw (err)
        }
    }

}


export async function getBskyTimeline(agent: SessionAgent, limit: number, data: Dataplane, cursor?: string): Promise<{
    feed: $Typed<FeedViewPost>[],
    cursor: string | undefined
}> {

    const t1 = Date.now()
    const res = await retry({limit, cursor}, agent.bsky.getTimeline, 3)
    const t2 = Date.now()

    logTimes("bsky timeline", [t1, t2])

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


async function getFollowingFeedSkeletonAllCASide(ctx: AppContext, agent: SessionAgent, data: Dataplane, startDate: Date) {
    const t1 = Date.now()

    const articlesQuery = getArticlesForFollowingFeed(
        ctx,
        agent,
        data,
        startDate
    )

    const t2 = Date.now()
    const articleRepostsQuery: Promise<RepostQueryResult[]> = getArticleRepostsForFollowingFeed(
        ctx,
        agent,
        data,
        startDate
    )

    const [articles, articleReposts, following] = await Promise.all([
        articlesQuery,
        articleRepostsQuery,
        getFollowing(ctx, agent.did)
    ])

    const t3 = Date.now()

    logTimes("following ca side", [t1, t2, t3])
    return {
        articles,
        articleReposts,
        following: [agent.did, ...following]
    }
}


const getFollowingFeedSkeletonAll: GetSkeletonProps = async (ctx, agent, data, cursor) => {
    if (!agent.hasSession()) return {skeleton: [], cursor: undefined}

    const timelineQuery = getBskyTimeline(agent, 25, data, cursor)

    const cursorDate = cursor ? new Date(cursor) : new Date()

    const t1 = Date.now()
    let [timeline, {articles, articleReposts, following}] = await Promise.all([
        timelineQuery,
        getFollowingFeedSkeletonAllCASide(ctx, agent, data, cursorDate)
    ])
    const t2 = Date.now()

    // borramos todos los artículos y reposts de artículos anteriores en fecha al último post de la timeline
    const lastInTimeline = timeline.feed.length > 0 ? timeline.feed[timeline.feed.length - 1].post.indexedAt : null
    if (lastInTimeline) {
        const lastInTimelineDate = new Date(lastInTimeline)
        articles = articles.filter(a => a.created_at >= lastInTimelineDate && a.created_at <= cursorDate)
        articleReposts = articleReposts.filter(a => a.createdAt && a.createdAt >= lastInTimelineDate && a.createdAt <= cursorDate)
    }

    const timelineSkeleton = getSkeletonFromTimeline(timeline.feed, following)

    const articleRepostsSkeleton = articleReposts.map(skeletonFromArticleReposts).filter(x => x != null)

    const skeleton = [
        ...timelineSkeleton,
        ...articles.map(a => ({post: a.uri})),
        ...articleRepostsSkeleton
    ]

    const t3 = Date.now()

    logTimes("following sk all", [t1, t2, t3])

    return {
        skeleton,
        cursor: timelineSkeleton.length > 0 ? timeline.cursor : undefined
    }
}


async function getCAFollows(ctx: AppContext, did: string): Promise<string[]> {
    const redisKey = `ca-follows:${did}`;

    const cached = await ctx.ioredis.get(redisKey);
    if (cached) {
        return JSON.parse(cached);
    }

    const rows = await ctx.kysely
        .selectFrom("Follow")
        .select("Follow.userFollowedId as did")
        .innerJoin("Record", "Follow.uri", "Record.uri")
        .innerJoin("User", "User.did", "Follow.userFollowedId")
        .where("Record.authorId", "=", did)
        .where("User.inCA", "=", true)
        .execute();

    const dids = rows.map(x => x.did).filter(x => x != null);

    await ctx.ioredis.set(redisKey, JSON.stringify(dids), "EX", 60 * 5); // 5 min TTL

    return dids
}

export type SkeletonQuery<T> = (
    ctx: AppContext,
    agent: Agent,
    from: string | undefined,
    to: string | undefined,
    limit: number
) => Promise<(T & {score: number})[]>


type FollowingFeedSkeletonElement = {
    uri: string
    createdAt: Date
    repostedRecordUri: string | undefined
}


const followingFeedOnlyCASkeletonQuery: SkeletonQuery<FollowingFeedSkeletonElement> = async (ctx, agent, from, to, limit) => {
    if(!agent.hasSession()) return []
    const follows = await getCAFollows(ctx, agent.did)

    const res = await ctx.kysely
        .selectFrom("Record")
        .where("Record.collection", "=", "ar.cabildoabierto.feed.article")
        .$if(from != null, qb => qb.where("Record.created_at", "<", new Date(from!)))
        .$if(to != null, qb => qb.where("Record.created_at", ">", new Date(to!)))
        .where("Record.authorId", "in", [...follows, agent.did])
        .where("Record.record", "is not", null)
        .select([
            "Record.uri as uri",
            "Record.created_at as createdAt",
            eb => eb.val<string | null>(null).as("repostedRecordUri")
        ])
        .unionAll(eb => eb
            .selectFrom("Record")
            .$if(from != null, qb => qb.where("Record.created_at", "<", new Date(from!)))
            .$if(to != null, qb => qb.where("Record.created_at", ">", new Date(to!)))
            .where("Record.authorId", "in", [...follows, agent.did])
            .where("Record.collection", "=", "app.bsky.feed.post")
            .where("Record.record", "is not", null)
            .leftJoin("Post", "Post.uri", "Record.uri")
            .where("Post.replyToId", "is", null)
            .select([
                "Record.uri as uri",
                "Record.created_at as createdAt",
                eb => eb.val<string | null>(null).as("repostedRecordUri")
            ])
        )
        .unionAll(eb => eb
            .selectFrom("Record")
            .$if(from != null, qb => qb.where("Record.created_at", "<", new Date(from!)))
            .$if(to != null, qb => qb.where("Record.created_at", ">", new Date(to!)))
            .where("Record.authorId", "in", [...follows, agent.did])
            .where("Record.collection", "=", "app.bsky.feed.repost")
            .where("Record.record", "is not", null)
            .leftJoin("Reaction", "Reaction.uri", "Record.uri")
            .leftJoin("Record as SubjectRecord", "SubjectRecord.uri", "Reaction.subjectId")
            .leftJoin("User as SubjectRecordAuthor", "SubjectRecordAuthor.did", "SubjectRecord.authorId")
            .where("SubjectRecordAuthor.inCA", "=", true)
            .where("SubjectRecord.collection", "in", ["app.bsky.feed.post", "ar.cabildoabierto.feed.article"])
            .where("SubjectRecord.record", "is not", null)
            .select([
                "Record.uri as uri",
                "Record.created_at as createdAt",
                "Reaction.subjectId as repostedRecordUri"
            ])
        )
        .orderBy("createdAt", "desc")
        .limit(limit)
        .execute()
    return res.map(r => ({
        uri: r.uri,
        repostedRecordUri: r.repostedRecordUri ?? undefined,
        createdAt: r.createdAt,
        score: r.createdAt.getTime()
    }))
}


const followingFeedOnlyArticlesSkeletonQuery: SkeletonQuery<FollowingFeedSkeletonElement> = async (ctx, agent, from, to, limit) => {
    if(!agent.hasSession()) return []
    const follows = await getCAFollows(ctx, agent.did)

    const res = await ctx.kysely
        .selectFrom("Record")
        .where("Record.collection", "=", "ar.cabildoabierto.feed.article")
        .$if(from != null, qb => qb.where("Record.created_at", "<", new Date(from!)))
        .$if(to != null, qb => qb.where("Record.created_at", ">", new Date(to!)))
        .where("Record.authorId", "in", [...follows, agent.did])
        .where("Record.record", "is not", null)
        .select([
            "Record.uri as uri",
            "Record.created_at as createdAt",
            eb => eb.val<string | null>(null).as("repostedRecordUri")
        ])
        .unionAll(eb => eb
            .selectFrom("Record")
            .$if(from != null, qb => qb.where("Record.created_at", "<", new Date(from!)))
            .$if(to != null, qb => qb.where("Record.created_at", ">", new Date(to!)))
            .where("Record.authorId", "in", [...follows, agent.did])
            .where("Record.collection", "=", "app.bsky.feed.repost")
            .where("Record.record", "is not", null)
            .leftJoin("Reaction", "Reaction.uri", "Record.uri")
            .leftJoin("Record as SubjectRecord", "SubjectRecord.uri", "Reaction.subjectId")
            .leftJoin("User as SubjectRecordAuthor", "SubjectRecordAuthor.did", "SubjectRecord.authorId")
            .where("SubjectRecordAuthor.inCA", "=", true)
            .where("SubjectRecord.collection", "=", "ar.cabildoabierto.feed.article")
            .where("SubjectRecord.record", "is not", null)
            .select([
                "Record.uri as uri",
                "Record.created_at as createdAt",
                "Reaction.subjectId as repostedRecordUri"
            ])
        )
        .orderBy("createdAt", "desc")
        .limit(limit)
        .execute()
    return res.map(r => ({
        uri: r.uri,
        repostedRecordUri: r.repostedRecordUri ?? undefined,
        score: r.createdAt.getTime(),
        createdAt: r.createdAt
    }))
}


export type GetCachedSkeletonOutput<T> = {
    skeleton: T[]
    cursor: string | undefined
}


export type GetNextCursor<T> = (cursor: string | undefined, skeleton: T[], limit: number) => (string | undefined)
export type CursorToScore = (cursor: string) => number
export type ScoreToCursor = (score: number) => string

export async function getCachedSkeleton<T>(
    ctx: AppContext,
    agent: Agent,
    redisKey: string,
    query: SkeletonQuery<T>,
    getNextCursor: GetNextCursor<T>,
    cursorToScore: CursorToScore,
    scoreToCursor: ScoreToCursor,
    limit: number, cursor?: string): Promise<GetCachedSkeletonOutput<T>> {
    function getCached() {
        const max = cursor ? cursorToScore(cursor)-1 : "+inf"
        return ctx.ioredis
            .zrevrangebyscore(
                redisKey,
                max,
                '-inf',
                'WITHSCORES',
                'LIMIT',
                0,
                limit
            )
    }

    function cachedToRes(cached: string[]) {
        const skeleton = cached
            .filter((x, i) => i % 2 == 0)
            .map(x => {
                return JSON.parse(x)
            })

        return {
            skeleton,
            cursor: getNextCursor(cursor, skeleton, limit)
        }
    }

    const cached = await getCached()
    const topCached: string | undefined = cached.length >= 2 ? scoreToCursor(Number(cached[1])) : undefined

    const res = await query(
        ctx,
        agent,
        cursor,
        topCached,
        100
    )

    if(res.length == 0){
        return cachedToRes(cached)
    }

    await ctx.ioredis.zadd(redisKey,
        ...res.flatMap(r => {
            return [r.score, JSON.stringify(r)]
        })
    )

    const newCached = await getCached()
    return cachedToRes(newCached)
}


export function getNextFollowingFeedCursor(cursor: string | undefined, skeleton: FollowingFeedSkeletonElement[], limit: number){
    if(skeleton.length < limit) return undefined
    const m = Math.min(...skeleton.map(x => new Date(x.createdAt).getTime()))
    return new Date(m).toISOString()
}


export function followingFeedCursorToScore(cursor: string) {
    return new Date(cursor).getTime()
}


export function followingFeedScoreToCursor(score: number) {
    return new Date(score).toISOString()
}


async function followingFeedOnlyCABaseQueryAll(ctx: AppContext, agent: SessionAgent, limit: number, cursor?: string): Promise<GetCachedSkeletonOutput<FollowingFeedSkeletonElement>> {
    return await getCachedSkeleton(
        ctx,
        agent,
        `following-feed-ca:${agent.did}`,
        followingFeedOnlyCASkeletonQuery,
        getNextFollowingFeedCursor,
        followingFeedCursorToScore,
        followingFeedScoreToCursor,
        limit,
        cursor
    )
}


async function followingFeedOnlyCABaseQueryArticles(ctx: AppContext, agent: SessionAgent, limit: number, cursor?: string): Promise<GetCachedSkeletonOutput<FollowingFeedSkeletonElement>> {
    return await getCachedSkeleton(
        ctx,
        agent,
        `following-feed-ca-articles:${agent.did}`,
        followingFeedOnlyArticlesSkeletonQuery,
        getNextFollowingFeedCursor,
        followingFeedCursorToScore,
        followingFeedScoreToCursor,
        limit,
        cursor
    )
}


const getFollowingFeedSkeletonOnlyCA: (format: FeedFormatOption) => GetSkeletonProps = (format) => async (ctx, agent, data, cursor) => {
    if (!agent.hasSession()) return {skeleton: [], cursor: undefined}

    const limit = 25

    const t1 = Date.now()
    const posts = await (format == "Todos" ?
        followingFeedOnlyCABaseQueryAll(ctx, agent, limit, cursor) :
        followingFeedOnlyCABaseQueryArticles(ctx, agent, limit, cursor))

    const t2 = Date.now()
    logTimes("posts for skeleton only ca", [t1, t2])

    function queryToSkeletonElement(e: {
        uri: string,
        repostedRecordUri?: string | null
    }): SkeletonFeedPost {
        if (!e.repostedRecordUri) {
            return {
                $type: "app.bsky.feed.defs#skeletonFeedPost",
                post: e.uri
            }
        } else {
            return {
                $type: "app.bsky.feed.defs#skeletonFeedPost",
                post: e.repostedRecordUri,
                reason: {
                    $type: "app.bsky.feed.defs#skeletonReasonRepost",
                    repost: e.uri
                }
            }
        }
    }

    const skeleton = posts.skeleton.map(queryToSkeletonElement)
    const newCursor = posts.cursor

    return {
        skeleton,
        cursor: newCursor
    }
}


export const getFollowingFeedSkeleton: (filter: FollowingFeedFilter, format: FeedFormatOption) => GetSkeletonProps = (filter, format) => async (ctx, agent, data, cursor) => {
    if (filter == "Todos" && format == "Todos") {
        return getFollowingFeedSkeletonAll(ctx, agent, data, cursor)
    } else {
        return getFollowingFeedSkeletonOnlyCA(format)(ctx, agent, data, cursor)
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
            const rootTopic = getRootTopicIdFromPost(a)
            if (rootTopic) {
                res.push(a)
            }
            console.warn("Warning: Filtrando porque no se encontró el root.")
        }
    })

    return res
}


export const getFollowingFeedPipeline: (filter?: FollowingFeedFilter, format?: FeedFormatOption) => FeedPipelineProps = (filter = "Todos", format = "Todos") => ({
    getSkeleton: getFollowingFeedSkeleton(filter, format),
    sortKey: rootCreationDateSortKey,
    filter: filterFeed
})