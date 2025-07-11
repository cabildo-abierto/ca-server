import {unique} from "#/utils/arrays";
import {AppContext} from "#/index";
import {getDidFromUri} from "#/utils/uri";
import {logTimes} from "#/utils/utils";
import {formatIsoDate} from "#/utils/dates";
import {testUsers} from "#/services/admin/stats";


export async function getLastContentInteractionsUpdate(ctx: AppContext){
    const lastUpdateStr = await ctx.ioredis.get("last-topic-interactions-update")
    return lastUpdateStr ? new Date(lastUpdateStr) : new Date(0)
}


export async function setLastContentInteractionsUpdate(ctx: AppContext, date: Date){
    await ctx.ioredis.set("last-topic-interactions-update", date.toISOString())
    console.log("Last topic interactions update set to", formatIsoDate(date))
}


export async function restartLastContentInteractionsUpdate(ctx: AppContext) {
    await setLastContentInteractionsUpdate(ctx, new Date(0))
}


async function createContentInteractions(ctx: AppContext) {
    // recorremos los records y por cada uno anotamos con qué temas interactúa
    // si es un post, vemos a quién menciona y a quién responde
    // si es un artículo solo vemos a quién menciona
    // si es una reacción solo vemos a qué record reacciona
    // si es un tema
    const lastUpdate = await getLastContentInteractionsUpdate(ctx)

    const batchSize = 5000
    let curOffset = 0

    while(true){
        console.log(`Updating topic interactions batch ${curOffset}`)
        const t1 = Date.now()
        const batchUris = await ctx.kysely.selectFrom("Record")
            .leftJoin("Post", "Record.uri", "Post.uri")
            .leftJoin("Reaction", "Record.uri", "Reaction.uri")
            .leftJoin("TopicVersion", "Record.uri", "TopicVersion.uri")
            .select(["Record.uri", "Post.replyToId", "Reaction.subjectId", "TopicVersion.topicId"])
            .where("Record.created_at", ">=", lastUpdate)
            .orderBy("Record.created_at asc")
            .limit(batchSize)
            .offset(curOffset)
            .execute()
        if(batchUris.length == 0) break
        curOffset += batchUris.length

        const batchReferences = await ctx.kysely
            .selectFrom("Reference")
            .select(["referencingContentId", "referencedTopicId"])
            .where("Reference.referencingContentId", "in", batchUris.map(u => u.uri))
            .execute()

        const urisIncSubjects: string[] = [
            ...batchUris.map(u => u.uri),
            ...batchUris.map(u => u.replyToId),
            ...batchUris.map(u => u.subjectId),
        ].filter(x => x != null)

        const batchReplyToInteractions = await ctx.kysely
            .selectFrom("TopicInteraction")
            .select(["TopicInteraction.topicId", "TopicInteraction.recordId"])
            .where("TopicInteraction.recordId", "in", urisIncSubjects)
            .execute()

        let values: {recordId: string, topicId: string}[] = []

        batchReferences.forEach(ref => {
            values.push({
                recordId: ref.referencingContentId,
                topicId: ref.referencedTopicId,
            })
        })

        batchReplyToInteractions.forEach(i => {
            values.push({
                recordId: i.recordId,
                topicId: i.topicId,
            })
        })

        batchUris.forEach(u => {
            if(u.topicId){
                values.push({
                    recordId: u.uri,
                    topicId: u.topicId
                })
            }
        })

        values = unique(values, v => `${v.recordId}:${v.topicId}`)
        const t2 = Date.now()

        console.log(`adding ${values.length} interactions`)

        if(values.length > 0){
            await ctx.kysely.insertInto("TopicInteraction")
                .values(values)
                .onConflict((oc) => oc.columns(["topicId", "recordId"]).doNothing())
                .execute()
        }
        const t3 = Date.now()
        logTimes("content interactions batch", [t1, t2, t3])
    }

    await setLastContentInteractionsUpdate(ctx, new Date())
}


async function updateTopicPopularities(ctx: AppContext) {
    const topics = await ctx.db.topic.findMany({
        select: {
            id: true
        }
    })

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

    let batchSize = 500
    for(let i = 0; i < topics.length; i+=batchSize){
        console.log("Updating batch", i)
        const batchIds = topics.slice(i, i+batchSize).map(i => i.id)
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

        console.log("values", values.length)

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
    console.log("creating interactions")
    const t1 = Date.now()
    await createContentInteractions(ctx)
    const t2 = Date.now()

    console.log("updating topic popularities")
    await updateTopicPopularities(ctx)
    const t3 = Date.now()

    logTimes("update topic popularities", [t1, t2, t3])
}