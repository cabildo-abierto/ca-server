import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {cleanText} from "#/utils/strings";
import {TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {AppContext} from "#/index";
import {JsonValue} from "@prisma/client/runtime/library";
import {topicQueryResultToTopicViewBasic} from "#/services/wiki/topics";
import {Dataplane, joinMaps} from "#/services/hydration/dataplane";
import {SessionAgent} from "#/utils/session-agent";
import {sql} from "kysely";
import {stringListIncludes, stringListIsEmpty} from "#/services/dataset/read";
import {$Typed} from "@atproto/api";


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
    let {q} = params
    const categories = query.c == undefined ? undefined : (typeof query.c == "string" ? [query.c] : query.c)
    const searchQuery = cleanText(q)

    const baseQuery = ctx.kysely
        .selectFrom('Topic')
        .innerJoin('TopicVersion', 'TopicVersion.uri', 'Topic.currentVersionId')
        .select(["id", "lastEdit", "popularityScoreLastDay", "popularityScoreLastWeek", "popularityScoreLastMonth", "TopicVersion.props"])
        // Add similarity calculation
        .select(eb => [
            eb.fn("similarity", [eb.ref('id'), eb.val(searchQuery)]).as('match_score'),
            eb.fn('levenshtein', [eb.ref('id'), eb.val(searchQuery)]).as('distance')
        ])

    const queryInCategories = categories ? baseQuery
        .where(categories.includes("Sin categoría") ?
            stringListIsEmpty("Categorías") :
            (eb) =>
                eb.and(categories.map(c => stringListIncludes("Categorías", c))
                )
        ) : baseQuery

    const topics = await queryInCategories
        .where(sql`unaccent("Topic"."id")`, 'ilike', sql`unaccent('%' || ${searchQuery} || '%')`)
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
            currentVersion: {
                props: t.props as JsonValue
            }
        }))
    }
}