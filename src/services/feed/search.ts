import {cleanText} from "#/utils/strings";
import {CAHandlerNoAuth} from "#/utils/handler";
import {FeedPipelineProps, getFeed, GetFeedOutput, GetSkeletonProps} from "#/services/feed/feed";
import {sql} from "kysely";


const getSearchContentsSkeleton: (q: string) => GetSkeletonProps = (q) => async (ctx, agent, data, cursor) => {
    const uris = await ctx.kysely
        .selectFrom("Content")
        .innerJoin("Record", "Record.uri", "Content.uri")
        .where("Record.collection", "in", ["ar.cabildoabierto.feed.article", "app.bsky.feed.post"])
        .where(
            sql<boolean>`"Content"."text_tsv" @@ plainto_tsquery('simple', immutable_unaccent(${q}))`
        )
        .innerJoin("User", "User.did", "Record.authorId")
        .where("User.inCA", "=", true)
        .select("Content.uri")
        .limit(25)
        .orderBy("Record.created_at", "desc")
        .execute();

    return {
        skeleton: uris.map(u => ({ post: u.uri })),
        cursor: undefined
    };
};


export const searchContents: CAHandlerNoAuth<{params: {q: string}}, GetFeedOutput> = async (ctx, agent, {params}) => {
    let {q} = params
    if(q.length == 0) return {data: {feed: [], cursor: undefined}}
    q = cleanText(q)

    const pipeline: FeedPipelineProps = {
        getSkeleton: getSearchContentsSkeleton(q),
    }

    return getFeed({ctx, agent, pipeline})
}