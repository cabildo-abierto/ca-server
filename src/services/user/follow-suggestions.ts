import {ProfileViewBasic} from "#/lex-server/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {CAHandler} from "#/utils/handler";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {sql} from "kysely";
import {AppContext} from "#/index";
import {v4 as uuidv4} from 'uuid'
import {logTimes} from "#/utils/utils";

/*
    1. Tomamos un conjunto de usuarios recomendadores. Los recomendadores son los seguidos del usuario o, si tiene muy pocos, todos los usuarios de CA.
    2. Tomamos a las 200 personas más seguidas entre los recomendadores
    3. Las ordenamos según:
     Porcentaje de recomendadores que siguen +
     Si está o no está en CA * 0.25 +
     Si escribió o no algún artículo * 0.25 +
     Si publicó al menos un post en las últimas dos semanas * 0.25
*/


async function getRecommendationRankingForUser(ctx: AppContext, did: string, limit: number, offset: number = 0): Promise<string[]> {
    const redisKey = `follow-suggestions:${did}:${limit}:${offset}`
    const inCache = await ctx.ioredis.get(redisKey)
    if(inCache != null){
        return JSON.parse(inCache)
    }

    const lastTwoWeeks = new Date(Date.now() - 1000*3600*24*14)
    const recommendations = await ctx.kysely
        .with("Follows", db => db
            .selectFrom("Follow")
            .innerJoin("Record", "Record.uri", "Follow.uri")
            .where("Record.authorId", "=", did)
            .select(["Follow.userFollowedId"])
        )
        .with("CAUsers", db => db
            .selectFrom("User")
            .where("User.inCA", "=", true)
            .select("did")
        )
        .with("FollowsCount", eb => eb.selectFrom("Follows").select(eb => eb.fn.count<number>("userFollowedId").as("count")))
        .with("Recommenders", db =>
            db.selectFrom("Follows")
                .select("userFollowedId as did")
                .where(
                    eb => eb(
                        eb.selectFrom("FollowsCount").select("count"),
                        ">=",
                        3
                    )
                )
                .unionAll(
                    db.selectFrom("CAUsers")
                        .select("did")
                        .where(
                            eb => eb(
                                eb.selectFrom("FollowsCount").select("count"),
                                "<",
                                3
                            )
                        )
                )
        )
        .with("Active", eb => eb
            .selectFrom("User")
            .innerJoin("Record", "Record.authorId", "User.did")
            .where("Record.created_at", ">", lastTwoWeeks)
            .select([
                "did",
                eb => eb.fn.count<number>("Record.uri").filterWhere("Record.collection", "=", "ar.cabildoabierto.feed.article").as("articles"),
                eb => eb.fn.count<number>("Record.uri").as("records")
            ])
            .groupBy("did")
        )
        .selectFrom("User as Candidate") // los candidatos son todas las personas seguidas por algun seguido de agent.did
        .innerJoin("Follow as Recommendation", "Recommendation.userFollowedId", "Candidate.did")
        .innerJoin("Record as RecommendationRecord", "RecommendationRecord.uri", "Recommendation.uri")
        .innerJoin("Recommenders", "Recommenders.did", "RecommendationRecord.authorId")
        .innerJoin("Active", "Active.did", "Candidate.did")
        .leftJoin("Follows", "Follows.userFollowedId", "Candidate.did")
        .where("Follows.userFollowedId", "is", null)
        .where("Candidate.did", "!=", did)
        .where(eb =>
            eb.not(
                eb.exists(
                    eb.selectFrom("NotInterested")
                        .select("id")
                        .whereRef("NotInterested.subjectId", "=", "Candidate.did")
                        .where("NotInterested.authorId", "=", did)
                )
            )
        )
        .select([
            "Candidate.did",
            sql<number>`
              (count("Candidate"."did")::float / (select count(*) from "Recommenders"))
              + CASE WHEN "Active"."articles" > 0 THEN 0.25 ELSE 0 END
              + CASE WHEN "Active"."records" > 0 THEN 0.25 ELSE 0 END
              + CASE WHEN "Candidate"."inCA" THEN 0.25 ELSE 0 END
            `.as("score")
        ])
        .groupBy(["Candidate.did", "Active.articles", "Active.records"])
        .orderBy("score", "desc")
        .orderBy("Candidate.did", "asc") // determinismo
        .limit(limit)
        .offset(offset)
        .execute()

    const dids = recommendations.map(r => r.did)

    await ctx.ioredis.set(redisKey, JSON.stringify(dids), 'EX', 3600*24)
    return dids
}


export const getFollowSuggestions: CAHandler<{params: {limit: number, offset: number}}, ProfileViewBasic[]> = async (ctx, agent, {params}) =>  {
    const t1 = Date.now()
    const dids = await getRecommendationRankingForUser(ctx, agent.did, params.limit, params.offset)
    const t2 = Date.now()

    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchUsersHydrationData(dids)
    const t3 = Date.now()
    logTimes("follow suggestions", [t1, t2, t3])

    const data = dids
        .map(d => hydrateProfileViewBasic(d, dataplane))
        .filter(x => x != null)

    return {data}
}


export async function redisDeleteByPrefix(ctx: AppContext, prefix: string) {
    const stream = ctx.ioredis.scanStream({
        match: `${prefix}*`,
        count: 100
    })

    stream.on("data", async (keys) => {
        if (keys.length) {
            const pipeline = ctx.ioredis.pipeline();
            keys.forEach((key: string) => pipeline.del(key));
            await pipeline.exec();
        }
    })
}


export const setNotInterested: CAHandler<{params: {subject: string}}, {}> = async (ctx, agent, {params}) => {
    await ctx.kysely
        .insertInto("NotInterested")
        .values([{
            id: uuidv4(),
            subjectId: params.subject,
            authorId: agent.did
        }])
        .execute()

    await redisDeleteByPrefix(ctx, `follow-suggestions:${agent.did}`)

    return {data: {}}
}