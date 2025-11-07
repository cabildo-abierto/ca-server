import {FeedPipelineProps, GetSkeletonProps} from "#/services/feed/feed.js";
import {stringListIncludes} from "#/services/dataset/read.js";

const getDiscoverFeedSkeleton: GetSkeletonProps = async (ctx, agent, data, cursor) => {
    if (!agent.hasSession()) return {skeleton: [], cursor: undefined}
    const interests = ['Economía', 'Ciencia y tecnología', 'Fútbol', "Poder Legislativo", "Leyes nacionales"]

    const t1 = Date.now()
    const temasDeCategorias = await ctx.kysely.selectFrom("Record")
        .select(["uri"])
        .innerJoin("User", "User.did", "Record.authorId")
        .where("User.inCA", "=", true)
        .where("Record.collection", "in", ['app.bsky.feed.post', 'ar.cabildoabierto.feed.article'])
        .where(eb => eb.exists(
            eb.selectFrom("Reference").whereRef('referencingContentId','=', 'Record.uri')
                .innerJoin('Topic', 'Topic.id', 'Reference.referencedTopicId')
                .innerJoin("TopicVersion", "Topic.currentVersionId", "TopicVersion.uri")
                .where(eb => eb.or(interests.map(i => stringListIncludes("Categorías", i))))
        ))
        .orderBy("Record.created_at", "desc")
        .limit(25)
        .execute()
    const t2 = Date.now()

    ctx.logger.logTimes("discover feed skeleton", [t1, t2])

    return {
        skeleton: temasDeCategorias.map(u => ({post: u.uri})),
        cursor: undefined
    }
}

export const discoverFeedPipeline: FeedPipelineProps = {
    getSkeleton: getDiscoverFeedSkeleton,
    sortKey: (a) => [0]
}

/* FEED CON TODOS LOS POSTS/ARTICULOS QUE CITAN ALGÚN TEMA, PARA INSPIRARSE EN QUÉ TEMAS FALTA DEFINIR
const temasDeCategorias = await ctx.kysely.selectFrom("Record")
        .select(["uri"])
        .innerJoin("User", "User.did", "Record.authorId")
        .where("User.inCA", "=", true)
        .where("Record.collection", "in", ['app.bsky.feed.post', 'ar.cabildoabierto.feed.article'])
        .where(eb => eb.exists(
            eb.selectFrom("Reference").whereRef('referencingContentId','=', 'Record.uri')
        ))
        .orderBy("Record.created_at", "desc")
        .limit(25)
        .execute()
*/