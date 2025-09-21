import {AppContext} from "#/setup";
import {getDidFromUri} from "#/utils/uri";
import {testUsers} from "#/services/admin/stats";
import {
    createContentInteractions,
    getEditedTopics,
    updateContentInteractionsForTopics
} from "#/services/wiki/interactions";
import {updateReferences} from "#/services/wiki/references";


export async function updateTopicPopularities(ctx: AppContext, topicIds: string[]) {
    const lastMonth = new Date(Date.now() - 1000*3600*24*30)
    const lastWeek = new Date(Date.now() - 1000*3600*24*7)
    const lastDay = new Date(Date.now() - 1000*3600*24)

    const humanUsers = new Set((await ctx.db.user.findMany({
        select: {
            did: true
        },
        where: {
            orgValidation: null,
            handle: {
                notIn: testUsers
            }
        }
    })).map(d => d.did))

    let batchSize = 2000
    for(let i = 0; i < topicIds.length; i+=batchSize){
        console.log("Updating batch", i)
        const batchIds = topicIds.slice(i, i+batchSize)
        const batchInteractions = await ctx.kysely
            .selectFrom("TopicInteraction")
            .innerJoin("Record", "Record.uri", "TopicInteraction.recordId")
            .select(["recordId", "topicId", "Record.created_at"])
            .where("Record.created_at", ">", lastMonth)
            .where("TopicInteraction.topicId", "in", batchIds)
            .execute()
        console.log(`Got ${batchInteractions.length} interactions in batch`)

        const m = new Map<string, {
            interactionsLastDay: Set<string>
            interactionsLastWeek: Set<string>
            interactionsLastMonth: Set<string>
        }>()
        batchInteractions.forEach((d) => {
            let cur = m.get(d.topicId)
            if(!cur){
                m.set(d.topicId, {
                    interactionsLastDay: new Set<string>(),
                    interactionsLastWeek: new Set<string>(),
                    interactionsLastMonth: new Set<string>()
                })
            }
            cur = m.get(d.topicId)
            if(cur){
                const authorId = getDidFromUri(d.recordId)
                if(humanUsers.has(authorId)){
                    cur.interactionsLastMonth.add(authorId)
                    if(d.created_at > lastWeek){
                        console.log(`Interaction: ${d.recordId}, ${d.topicId}`)
                        cur.interactionsLastWeek.add(authorId)
                    }
                    if(d.created_at > lastDay){
                        cur.interactionsLastDay.add(authorId)
                    }

                    m.set(d.topicId, cur)
                }
            }
        })

        const values = Array.from(m).map(x => ({
            id: x[0],
            popularityScoreLastDay: x[1].interactionsLastDay.size,
            popularityScoreLastWeek: x[1].interactionsLastWeek.size,
            popularityScoreLastMonth: x[1].interactionsLastMonth.size
        }))

        if(values.length == 0) continue

        await ctx.kysely
            .insertInto("Topic")
            .values(values)
            .onConflict((oc) => oc.column("id").doUpdateSet({
                popularityScoreLastDay: eb => eb.ref("excluded.popularityScoreLastDay"),
                popularityScoreLastWeek: eb => eb.ref("excluded.popularityScoreLastWeek"),
                popularityScoreLastMonth: eb => eb.ref("excluded.popularityScoreLastMonth")
            }))
            .execute()
    }
}


export async function updateTopicPopularityScores(ctx: AppContext) {
    const t1 = Date.now()
    await updateReferences(ctx)

    const since = await ctx.redisCache.lastTopicInteractionsUpdate.get()
    const topicIds = await getEditedTopics(ctx, since)
    const t2 = Date.now()

    await updateContentInteractionsForTopics(ctx, topicIds)
    const t3 = Date.now()

    await createContentInteractions(ctx)
    const t4 = Date.now()

    const allTopicIds = await ctx.kysely
        .selectFrom("Topic")
        .select("id")
        .execute()
    const t5 = Date.now()

    await updateTopicPopularities(ctx, allTopicIds.map(t => t.id))
    const t6 = Date.now()

    ctx.logger.logTimes("update topic popularities", [t1, t2, t3, t4, t5, t6])
}