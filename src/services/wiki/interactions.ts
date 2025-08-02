import {AppContext} from "#/index";
import {unique} from "#/utils/arrays";
import {formatIsoDate} from "#/utils/dates";
import {logTimes} from "#/utils/utils";
import {sql} from "kysely";


export async function getLastContentInteractionsUpdate(ctx: AppContext) {
    const lastUpdateStr = await ctx.ioredis.get("last-topic-interactions-update")
    return lastUpdateStr ? new Date(lastUpdateStr) : new Date(0)
}


export async function setLastContentInteractionsUpdate(ctx: AppContext, date: Date) {
    await ctx.ioredis.set("last-topic-interactions-update", date.toISOString())
    console.log("Last topic interactions update set to", formatIsoDate(date))
}


export async function restartLastContentInteractionsUpdate(ctx: AppContext) {
    await setLastContentInteractionsUpdate(ctx, new Date(Date.now()-1000*3600*24*7))
}


export async function createContentInteractions(ctx: AppContext) {
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
            .where("Record.CAIndexedAt", ">=", lastUpdate)
            .orderBy("Record.CAIndexedAt asc")
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



export async function updateContentInteractionsForTopics(ctx: AppContext, topicIds: string[]) {
    const batchSize = 10

    for (let i = 0; i < topicIds.length; i += batchSize) {

        console.log(`Updating topic interactions batch ${i} of ${topicIds.length}`)
        const t1 = Date.now()

        const batchTopics = topicIds.slice(i, i + batchSize)

        const batchUris = await ctx.kysely
            .withRecursive("thread", (db) => {
                const base = db.selectFrom("Record")
                    .leftJoin("TopicVersion", "Record.uri", "TopicVersion.uri")
                    .leftJoin("Reference", "Reference.referencingContentId", "Record.uri")
                    .leftJoin("Post", "Post.uri", "Record.uri")
                    .select([
                        "Record.uri",
                        "TopicVersion.topicId",
                        "Reference.referencedTopicId",
                        eb => eb.lit<number>(0).as("depth")
                    ])
                    .where((eb) =>
                        eb.or([
                            eb("TopicVersion.topicId", "in", batchTopics),
                            eb("Reference.referencedTopicId", "in", batchTopics),
                        ])
                    )
                    .distinctOn("Record.uri");

                const recursive = db
                    .selectFrom("thread")
                    .innerJoin("Post", "Post.replyToId", "thread.uri")
                    .select([
                        "Post.uri",
                        "thread.topicId",
                        "thread.referencedTopicId",
                        sql<number>`thread.depth + 1`.as("depth")
                    ])
                    .where("thread.depth", "<", 50)
                    .distinctOn("Post.uri")

                return base.unionAll(recursive);
            })
            .selectFrom("thread")
            .selectAll()
            .execute()

        const reactions = await ctx.kysely
            .selectFrom("Reaction")
            .select(["Reaction.uri", "Reaction.subjectId"])
            .where("Reaction.subjectId", "in", batchUris.map(u => u.uri))
            .execute()

        let values: { recordId: string, topicId: string }[] = []

        batchUris.forEach(r => {
            const topicId = r.topicId ?? r.referencedTopicId
            if(topicId){
                values.push({
                    recordId: r.uri,
                    topicId
                })
            }
        })

        const urisToTopicMap = new Map<string, string>(values.map(x => [x.recordId, x.topicId]))

        reactions.forEach(r => {
            if(!r.subjectId) return
            const topicId = urisToTopicMap.get(r.subjectId)
            if(!topicId) return
            values.push({
                recordId: r.uri,
                topicId
            })
        })

        values = unique(values, v => `${v.recordId}:${v.topicId}`)
        const t2 = Date.now()

        console.log(`adding ${values.length} interactions`)

        if (values.length > 0) {
            await ctx.kysely.insertInto("TopicInteraction")
                .values(values)
                .onConflict((oc) => oc.columns(["topicId", "recordId"]).doNothing())
                .execute()
        }

        let deleteQuery = ctx.kysely.deleteFrom("TopicInteraction")
            .where("topicId", "in", topicIds)

        if(values.length > 0) {
            deleteQuery = deleteQuery
                .where(({eb, refTuple, tuple}) =>
                    eb(
                        refTuple("TopicInteraction.recordId", 'TopicInteraction.topicId'),
                        'not in',
                        values.map(e => tuple(e.recordId, e.topicId))
                    )
                )
        }

        await deleteQuery.execute()

        const t3 = Date.now()
        logTimes("content interactions batch", [t1, t2, t3])
    }
}


export async function getEditedTopics(ctx: AppContext) {
    const lastUpdate = await getLastContentInteractionsUpdate(ctx)

    const topics = await ctx.kysely
        .selectFrom("Topic")
        .select("id")
        .where("Topic.lastEdit", ">", lastUpdate)
        .execute()

    return topics.map(t => t.id)
}


export async function updateContentInteractionsForEditedTopics(ctx: AppContext) {
    const topicIds = await getEditedTopics(ctx)

    await updateContentInteractionsForTopics(ctx, topicIds)

    await setLastContentInteractionsUpdate(ctx, new Date())
}