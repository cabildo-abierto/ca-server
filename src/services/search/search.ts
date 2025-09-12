import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {cleanText} from "#/utils/strings";
import {TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {AppContext} from "#/setup";
import {JsonValue} from "@prisma/client/runtime/library";
import {topicQueryResultToTopicViewBasic} from "#/services/wiki/topics";
import {Dataplane, joinMaps} from "#/services/hydration/dataplane";
import {SessionAgent} from "#/utils/session-agent";
import {stringListIncludes, stringListIsEmpty} from "#/services/dataset/read";
import {$Typed} from "@atproto/api";
import {sql} from "kysely";


export async function searchUsersInCA(ctx: AppContext, query: string, dataplane: Dataplane): Promise<string[]> {
    let caUsers: {did: string, handle: string, displayName?: string, avatar?: string, CAProfileUri?: string}[] = (await ctx.db.$queryRaw`
        SELECT 
            u."did",
            u."handle",
            u."displayName",
            u."avatar",
            u."CAProfileUri"
        FROM "User" u
        WHERE u."displayName" ILIKE '%' || ${query} || '%'
           OR u."handle" ILIKE '%' || ${query} || '%'
    `)

    const views = caUsers.map(u => ({
        ...u,
        caProfile: u.CAProfileUri
    }))

    dataplane.caUsers = joinMaps(
        dataplane.caUsers,
        new Map<string, CAProfileViewBasic>(views.map(a => [a.did, a]))
    )

    return views.map(a => a.did)
}


export async function searchUsersInBsky(agent: SessionAgent, query: string, dataplane: Dataplane): Promise<string[]> {
    const {data} = await agent.bsky.searchActorsTypeahead({q: query})

    dataplane.bskyUsers = joinMaps(
        dataplane.bskyUsers,
        new Map<string, $Typed<ProfileViewBasic>>(data.actors.map(a => [a.did, {
            $type: "app.bsky.actor.defs#profileViewBasic", ...a
        }]))
    )

    return data.actors.map(a => a.did)
}


export const searchUsers: CAHandler<{
    params: { query: string }
}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    const {query} = params

    const dataplane = new Dataplane(ctx, agent)

    let [caSearchResults, bskySearchResults] = await Promise.all([
        searchUsersInCA(ctx, query, dataplane),
        searchUsersInBsky(agent, query, dataplane)
    ])

    const userList = unique([
        ...caSearchResults,
        ...bskySearchResults
    ]).slice(0, 25)

    await dataplane.fetchUsersHydrationData(userList)

    const users = userList.map(did => hydrateProfileViewBasic(did, dataplane))

    return {data: users.filter(x => x != null)}
}


export const searchTopics: CAHandler<{params: {q: string}, query: {c: string | string[] | undefined}}, TopicViewBasic[]> = async (ctx, agent, {params, query}) => {
    let {q} = params;
    const categories = query.c == undefined ? undefined : (typeof query.c == "string" ? [query.c] : query.c);
    const searchQuery = cleanText(q);

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
                            .where("ReadSession.userId", "=", agent.did)
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
        .where((eb) => {
            const conditions = [
                eb(eb.fn('unaccent', [eb.ref('title')]), 'ilike', eb.val(`%${searchQuery}%`))
            ]

            if (categories) {
                conditions.push(
                    categories.includes("Sin categoría") ?
                        eb.val(stringListIsEmpty("Categorías")) :
                        eb.and(categories.map(c => stringListIncludes("Categorías", c)))
                )
            }

            return eb.and(conditions)
        })
        .orderBy('match_score', 'desc')
        .orderBy('popularityScoreLastDay', 'desc')
        .limit(20)
        .execute();

    return {
        data: topics.map(t => topicQueryResultToTopicViewBasic({
            id: t.id,
            popularityScoreLastDay: t.popularityScoreLastDay,
            popularityScoreLastWeek: t.popularityScoreLastWeek,
            popularityScoreLastMonth: t.popularityScoreLastMonth,
            lastEdit: t.lastEdit,
            currentVersion: {
                props: t.props as JsonValue
            },
            numWords: t.numWords,
            lastRead: t.lastRead
        }))
    };
};