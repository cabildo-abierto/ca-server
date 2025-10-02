import {CAHandlerNoAuth} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {cleanText} from "#/utils/strings";
import {TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {AppContext} from "#/setup";
import {topicQueryResultToTopicViewBasic} from "#/services/wiki/topics";
import {Dataplane, joinMaps} from "#/services/hydration/dataplane";
import {Agent} from "#/utils/session-agent";
import {stringListIncludes, stringListIsEmpty} from "#/services/dataset/read";
import {$Typed} from "@atproto/api";
import {sql} from "kysely";


export async function searchUsersInCA(ctx: AppContext, query: string, dataplane: Dataplane, limit: number): Promise<string[]> {
    const MIN_SIMILARITY_THRESHOLD = 0.1

    let users = await ctx.kysely
        .selectFrom("User")
        .select([
            "did",
            eb => sql<number>`GREATEST(
                similarity(${eb.ref('User.displayName')}::text, ${eb.val(query)}::text),
                similarity(${eb.ref('User.handle')}::text, ${eb.val(query)}::text)
            )`.as('match_score')

        ])
        .where("User.inCA", "=", true)
        .where(eb => eb.or([
            eb(sql<number>`similarity(${eb.ref('User.displayName')}::text, ${eb.val(query)}::text)`, ">=", MIN_SIMILARITY_THRESHOLD),
            eb(sql<number>`similarity(${eb.ref('User.handle')}::text, ${eb.val(query)}::text)`, ">=", MIN_SIMILARITY_THRESHOLD)
        ]))
        .orderBy("match_score desc")
        .limit(limit)
        .execute()

    return users.map(a => a.did)
}


export async function searchUsersInBsky(agent: Agent, query: string, dataplane: Dataplane, limit: number): Promise<string[]> {
    const {data} = await agent.bsky.app.bsky.actor.searchActorsTypeahead({q: query, limit})

    dataplane.bskyBasicUsers = joinMaps(
        dataplane.bskyBasicUsers,
        new Map<string, $Typed<ProfileViewBasic>>(data.actors.map(a => [a.did, {
            $type: "app.bsky.actor.defs#profileViewBasic", ...a
        }]))
    )

    return data.actors.map(a => a.did)
}


export const searchUsers: CAHandlerNoAuth<{
    params: { query: string }, query?: {limit?: number}
}, CAProfileViewBasic[]> = async (ctx, agent, {params, query}) => {
    const {query: searchQuery} = params
    const limit = query?.limit ?? 25

    const dataplane = new Dataplane(ctx, agent)

    const t1 = Date.now()
    let [caSearchResults, bskySearchResults] = await Promise.all([
        searchUsersInCA(ctx, searchQuery, dataplane, limit),
        searchUsersInBsky(agent, searchQuery, dataplane, limit)
    ])
    const t2 = Date.now()

    let usersList: string[] = []
    for(let i = 0; i < limit; i++){
        if(caSearchResults.length > i){
            if(!usersList.includes(caSearchResults[i])) usersList.push(caSearchResults[i])
        }
        if(bskySearchResults.length > i) {
            if(!usersList.includes(bskySearchResults[i])) usersList.push(bskySearchResults[i])
        }
    }
    usersList = usersList.slice(0, limit)

    await dataplane.fetchProfileViewHydrationData(usersList)
    const t3 = Date.now()

    ctx.logger.logTimes(`search users ${searchQuery}`, [t1, t2, t3])

    const users = usersList.map(did => hydrateProfileViewBasic(ctx, did, dataplane))

    return {data: users.filter(x => x != null)}
}


export const searchTopics: CAHandlerNoAuth<{params: {q: string}, query: {c: string | string[] | undefined}}, TopicViewBasic[]> = async (ctx, agent, {params, query}) => {
    let {q} = params;
    const categories = query.c == undefined ? undefined : (typeof query.c == "string" ? [query.c] : query.c);
    const searchQuery = cleanText(q);

    const did = agent.hasSession() ? agent.did : undefined

    const topics = await ctx.kysely
        .with('topics_with_titles', (eb) =>
            eb.selectFrom('Topic')
                .innerJoin('TopicVersion', 'TopicVersion.uri', 'Topic.currentVersionId')
                .innerJoin("Content", "Content.uri", "TopicVersion.uri")
                .select([
                    'Topic.id',
                    'Topic.lastEdit',
                    'Topic.popularityScoreLastDay',
                    'Topic.popularityScoreLastWeek',
                    'Topic.popularityScoreLastMonth',
                    'TopicVersion.props',
                    "Content.numWords",
                    eb => (
                        eb
                            .selectFrom("ReadSession")
                            .select(
                                [eb => eb.fn.max("ReadSession.created_at").as("lastRead")
                                ])
                            .where("ReadSession.userId", "=", did ?? "no did")
                            .whereRef("ReadSession.readContentId", "=", "TopicVersion.uri").as("lastRead")
                    ),
                    eb => eb.fn.coalesce(
                        eb.cast<string>(eb.fn('jsonb_path_query_first', [
                            eb.ref('TopicVersion.props'),
                            eb.val('$[*] ? (@.name == "Título").value.value')
                        ]), "text"),
                        eb.cast(eb.ref('Topic.id'), 'text')
                    ).as('title')
                ])
        )
        .selectFrom('topics_with_titles')
        .selectAll()
        .select(eb => [
            sql<number>`similarity(${eb.ref('title')}::text, ${eb.val(searchQuery)}::text)`.as('match_score')
        ])
        .$if(categories != null, qb => qb.where(eb => categories!.includes("Sin categoría") ?
            eb.val(stringListIsEmpty("Categorías")) :
            eb.and(categories!.map(c => stringListIncludes("Categorías", c)))))
        .where(eb => sql<number>`similarity(${eb.ref('title')}::text, ${eb.val(searchQuery)}::text)`, ">", 0.1)
        .orderBy('match_score', 'desc')
        .orderBy('popularityScoreLastDay', 'desc')
        .limit(20)
        .execute()

    return {
        data: topics.map(t => topicQueryResultToTopicViewBasic({
            id: t.id,
            popularityScoreLastDay: t.popularityScoreLastDay,
            popularityScoreLastWeek: t.popularityScoreLastWeek,
            popularityScoreLastMonth: t.popularityScoreLastMonth,
            lastEdit: t.lastEdit,
            props: t.props,
            numWords: t.numWords,
            lastRead: t.lastRead
        }))
    };
};