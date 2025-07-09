import {cleanText} from "#/utils/strings";
import {CAHandler} from "#/utils/handler";
import {FeedPipelineProps, getFeed, GetFeedOutput, GetSkeletonProps} from "#/services/feed/feed";


const getSearchContentsSkeleton: (q: string) => GetSkeletonProps = (q) => async (ctx, agent, data, cursor) => {
    // solo los posts tienen atributo text en content, el resto suelen usar blobs
    const postUris: {uri: string}[] = await ctx.db.$queryRaw`
      SELECT "uri"
      FROM "Content"
      WHERE to_tsvector('simple', immutable_unaccent("text")) @@ plainto_tsquery('simple', immutable_unaccent(${q}))
      ORDER BY ts_rank(to_tsvector('simple', immutable_unaccent("text")), plainto_tsquery('simple', immutable_unaccent(${q}))) DESC
      LIMIT 10
    `;
    const articleUris: {uri: string}[] = await ctx.db.$queryRaw`
      SELECT "uri"
      FROM "Article"
      WHERE to_tsvector('simple', immutable_unaccent("title")) @@ plainto_tsquery('simple', immutable_unaccent(${q}))
      ORDER BY ts_rank(to_tsvector('simple', immutable_unaccent("title")), plainto_tsquery('simple', immutable_unaccent(${q}))) DESC
      LIMIT 10
    `;

    const res: string[] = []
    let i = 0
    while(i < postUris.length || i < articleUris.length){
        if(i < postUris.length) res.push(postUris[i].uri)
        if(i < articleUris.length) res.push(articleUris[i].uri)
        i++
    }

    return {skeleton: res.map(u => ({post: u})), cursor: undefined}
}


export const searchContents: CAHandler<{params: {q: string}}, GetFeedOutput> = async (ctx, agent, {params}) => {
    let {q} = params
    if(q.length == 0) return {data: {feed: [], cursor: undefined}}
    q = cleanText(q)

    const pipeline: FeedPipelineProps = {
        getSkeleton: getSearchContentsSkeleton(q),
    }

    return getFeed({ctx, agent, pipeline})
}