import {cleanText} from "#/utils/strings";
import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import {FeedPipelineProps, getFeed, GetFeedOutput, GetSkeletonProps} from "#/services/feed/feed";
import {sql} from "kysely";


const getSearchContentsSkeleton: (q: string) => GetSkeletonProps = (q) => async (ctx, agent, data, cursor) => {
    const uris = await ctx.kysely
        .selectFrom("Content")
        .innerJoin("Record", "Record.uri", "Content.uri")
        .where("Record.collection", "in", ["ar.cabildoabierto.feed.article", "app.bsky.feed.post"])
        .select("Content.uri")
        .limit(25)
        .where(sql`to_tsvector('simple', immutable_unaccent("text"))`,"@@" , sql`plainto_tsquery('simple', immutable_unaccent(${q}))`)
        .orderBy(sql`ts_rank(to_tsvector('simple', immutable_unaccent("text")), plainto_tsquery('simple', immutable_unaccent(${q}))) DESC`)
        .execute()

    return {
        skeleton: uris.map(u => ({post: u.uri})),
        cursor: undefined
    }
}


export const searchContents: CAHandlerNoAuth<{params: {q: string}}, GetFeedOutput> = async (ctx, agent, {params}) => {
    let {q} = params
    if(q.length == 0) return {data: {feed: [], cursor: undefined}}
    q = cleanText(q)

    const pipeline: FeedPipelineProps = {
        getSkeleton: getSearchContentsSkeleton(q),
    }

    return getFeed({ctx, agent, pipeline})
}