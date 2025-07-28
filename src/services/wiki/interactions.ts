import {AppContext} from "#/index";
import {unique} from "#/utils/arrays";
import {formatIsoDate} from "#/utils/dates";
import {logTimes} from "#/utils/utils";


export async function getLastContentInteractionsUpdate(ctx: AppContext) {
    const lastUpdateStr = await ctx.ioredis.get("last-topic-interactions-update")
    return lastUpdateStr ? new Date(lastUpdateStr) : new Date(0)
}


export async function setLastContentInteractionsUpdate(ctx: AppContext, date: Date) {
    await ctx.ioredis.set("last-topic-interactions-update", date.toISOString())
    console.log("Last topic interactions update set to", formatIsoDate(date))
}


export async function restartLastContentInteractionsUpdate(ctx: AppContext) {
    await setLastContentInteractionsUpdate(ctx, new Date(0))
}

export async function updateContentInteractionsForTopics(ctx: AppContext, topicIds: string[]) {
    const batchSize = 500

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
                    .select(["Record.uri", "TopicVersion.topicId", "Reference.referencedTopicId"])
                    .where(eb => eb.or([
                        eb("TopicVersion.topicId", "in", batchTopics), // ediciones del tema
                        eb("Reference.referencedTopicId", "in", batchTopics) // referencias al tema
                    ]))
                    .distinctOn("Record.uri")

                const recursive = db
                    .selectFrom("thread")
                    .innerJoin("Post", "Post.replyToId", "thread.uri")
                    .select(["Post.uri", "thread.topicId", "thread.referencedTopicId"])

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