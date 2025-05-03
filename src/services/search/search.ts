import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {getCADataForUsers} from "#/services/user/users";
import {cleanText} from "#/utils/strings";
import {TopicProp, TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import { Prisma } from "@prisma/client";
import {AppContext} from "#/index";
import { JsonObject } from "@prisma/client/runtime/library";
import {hydrateTopicViewBasicFromTopicId, topicQueryResultToTopicViewBasic} from "#/services/topic/topics";
import {Dataplane, HydrationData} from "#/services/hydration/dataplane";


export async function searchUsersInCA(ctx: AppContext, query: string): Promise<CAProfileViewBasic[]> {
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
    return caUsers.map(u => ({
        ...u,
        caProfile: u.CAProfileUri
    }))
}


export const searchUsers: CAHandler<{
    params: { query: string }
}, CAProfileViewBasic[]> = async (ctx, agent, {params}) => {
    const {query} = params
    const {data} = await agent.bsky.searchActorsTypeahead({q: query})

    let [caSearchResults, caUsers] = await Promise.all([
        searchUsersInCA(ctx, query),
        getCADataForUsers(ctx, data.actors.map(a => a.did))
    ])

    caUsers = [...caSearchResults, ...caUsers]

    const hData: HydrationData = {
        bskyUsers: new Map<string, ProfileViewBasic>(data.actors.map(a => [a.did, a])),
        caUsers: new Map<string, CAProfileViewBasic>(caUsers.map(a => [a.did, a]))
    }

    const userList = unique([
        ...caUsers.map(u => u.did),
        ...data.actors.map(u => u.did)
    ])

    const dataplane = new Dataplane(ctx, agent)
    dataplane.data = hData // TO DO: Refactor

    const users = userList.map(did => hydrateProfileViewBasic(did, dataplane))

    return {data: users.filter(x => x != null)}
}


export function isJsonArray(value: Prisma.JsonValue): value is Prisma.JsonArray {
    return Array.isArray(value);
}

export function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


export function isJsonArrayOfObjects(value: Prisma.JsonValue): value is Prisma.JsonObject[] {
    return (
        Array.isArray(value) &&
        value.every(
            (item) =>
                typeof item === 'object' &&
                item !== null &&
                !Array.isArray(item)
        )
    );
}


export function dbPropToTopicProp(p: JsonObject): TopicProp {
    if(p.value && isJsonObject(p.value) && p.value.$type == "ar.cabildoabierto.wiki.topicVersion#stringProps" +
        ""){
        return {
            name: p.name as string,
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringProp",
                value: p.value.value as string
            }
        }
    } else if(p.value && isJsonObject(p.value) && p.value.$type == "ar.cabildoabierto.wiki.topicVersion#stringListProp"){
        return {
            name: p.name as string,
            value: {
                $type: "ar.cabildoabierto.wiki.topicVersion#stringProp",
                value: p.value.value as string
            }
        }
    } else if(p.value && isJsonObject(p.value) && p.value.$type){
        return {
            name: p.name as string,
            value: {
                $type: p.value.$type as string
            }
        }
    } else {
        throw Error("Propiedad inválida:", p)
    }
}


export async function getSearchTopicsSkeleton(ctx: AppContext, query: string) {
    let topics: {id: string}[]= await ctx.db.$queryRaw`
        SELECT t."id"
        FROM "Topic" t
                 LEFT JOIN "TopicVersion" tv
                           ON t."currentVersionId" = tv."uri"
        WHERE t."id" ILIKE '%' || ${query} || '%'
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

