import {CAHandler} from "#/utils/handler";
import {HydrationData} from "#/services/hydration/hydrate";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {unique} from "#/utils/arrays";
import {getCADataForUsers} from "#/services/user/users";
import {cleanText} from "#/utils/strings";
import {TopicProp, TopicViewBasic} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import { Prisma } from "@prisma/client";
import {AppContext} from "#/index";


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

    const users = userList.map(did => hydrateProfileViewBasic(did, hData))

    return {data: users.filter(x => x != null)}
}


function isJsonArray(value: Prisma.JsonValue): value is Prisma.JsonArray {
    return Array.isArray(value);
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isJsonArrayOfObjects(value: Prisma.JsonValue): value is Prisma.JsonObject[] {
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


export const searchTopics: CAHandler<{params: {q: string}}, TopicViewBasic[]> = async (ctx, agent, {params}) => {
    let {q} = params
    const query = cleanText(q)

    type TopicResult = {
        id: string;
        lastEdit: Date;
        popularityScore: number;
        props: Prisma.JsonValue;
        categories: string
        synonyms: string
    };

    let topics: TopicResult[] = await ctx.db.$queryRaw<TopicResult[]>`
        SELECT t."id",
               t."lastEdit",
               t."popularityScore",
               tv."props",
               tv."categories",
               tv."synonyms"
        FROM "Topic" t
                 LEFT JOIN "TopicVersion" tv
                           ON t."currentVersionId" = tv."uri"
        WHERE t."id" ILIKE '%' || ${query} || '%'
            LIMIT 20
    `;

    const views: TopicViewBasic[] = topics.map(t => {
        if(t.props == null || (isJsonArrayOfObjects(t.props))){

            const props: TopicProp[] = t.props ? t.props.map(p => ({name: p.name as string, value: p.value as string, dataType: p.dataType as string})) : []

            if(t.categories){
                const c: string[] = JSON.parse(t.categories)
                props.push({name: "Categorías", value: JSON.stringify(c), dataType: "string[]"})
            }
            if(t.synonyms){
                const s: string[] = JSON.parse(t.synonyms)
                props.push({name: "Sinónimos", value: JSON.stringify(s), dataType: "string[]"})
            }

            const view: TopicViewBasic = {
                $type: "ar.cabildoabierto.wiki.topicVersion#topicViewBasic",
                id: t.id,
                lastEdit: t.lastEdit?.toISOString(),
                popularity: [t.popularityScore],
                props
            }
            return view
        } else {
            return null
        }
    }).filter(t => t != null)

    return {
        data: views
    }
}

