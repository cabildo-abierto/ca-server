import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {cleanText} from "#/utils/strings";
import {TopicProp, TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import { Prisma } from "@prisma/client";
import {AppContext} from "#/index";
import { JsonObject } from "@prisma/client/runtime/library";
import {hydrateTopicViewBasicFromTopicId} from "#/services/wiki/topics";
import {Dataplane, joinMaps} from "#/services/hydration/dataplane";
import {SessionAgent} from "#/utils/session-agent";


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
        new Map<string, ProfileViewBasic>(data.actors.map(a => [a.did, a]))
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

export function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


export async function getSearchTopicsSkeleton(ctx: AppContext, query: string) {
    let topics: {id: string}[]= await ctx.db.$queryRaw`
        SELECT t."id"
        FROM "Topic" t
        WHERE unaccent(t."id") ILIKE unaccent('%' || ${query} || '%')
            LIMIT 20
    `;

    return topics
}


export const searchTopics: CAHandler<{params: {q: string}}, TopicViewBasic[]> = async (ctx, agent, {params}) => {
    let {q} = params
    const query = cleanText(q)
    const skeleton = await getSearchTopicsSkeleton(ctx, query)

    const data = new Dataplane(ctx, agent)
    await data.fetchTopicsBasicByIds(skeleton.map(x => x.id))

    return {data: skeleton.map(({id}) => hydrateTopicViewBasicFromTopicId(id, data)).filter(x => x != null)}
}

