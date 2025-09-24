import {AppContext} from "#/setup";
import {getTopicCategories} from "#/services/wiki/utils";
import {
    TopicProp
} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";

export async function updateTopicsCategories(ctx: AppContext) {
    const topics = await ctx.kysely
        .selectFrom('Topic')
        .select(['id'])
        .leftJoin('TopicVersion', 'TopicVersion.uri', 'Topic.currentVersionId')
        .select([
            'TopicVersion.props'
        ])
        .execute();

    const topicCategories = topics.map((t) => ({
        topicId: t.id,
        categoryIds: getTopicCategories(t.props as unknown as TopicProp[])
    }))

    const t1 = Date.now();

    const allCategoryIds = [
        ...new Set(topicCategories.flatMap(({categoryIds}) => categoryIds))
    ];

    if (allCategoryIds.length === 0) {
        console.log('No categories to update.');
        return;
    }


    await ctx.kysely.transaction().execute(async (trx) => {
        try {
            await trx
                .insertInto('TopicCategory')
                .values(allCategoryIds.map(id => ({id})))
                .onConflict((oc) => oc.column('id').doNothing())
                .execute();
        } catch (err) {
            console.log(`Error inserting categories: ${err}.`);
        }

        const topicCategoryValues = topicCategories.flatMap(({topicId, categoryIds}) =>
            categoryIds.map((categoryId) => ({
                topicId,
                categoryId
            }))
        );

        if (topicCategoryValues.length === 0) {
            console.log('No topic-category relationships to update.');
            return;
        }

        let existing: {topicId: string, categoryId: string}[] = []
        try {
            existing = await trx
                .selectFrom('TopicToCategory')
                .select(['topicId', 'categoryId'])
                .execute();
        } catch (err) {
            console.log("Error getting existing relations", err)
            return
        }
        const batchSize = 2000;

        ctx.logger.pino.info({count: topicCategoryValues.length}, "inserting new category relations")

        for(let i = 0; i < topicCategoryValues.length; i += batchSize) {
            console.log(`Batch ${i}.`)
            try {
                await trx
                    .insertInto('TopicToCategory')
                    .values(topicCategoryValues.slice(i, i + batchSize))
                    .onConflict((oc) => oc.columns(['topicId', 'categoryId']).doNothing())
                    .execute();
            } catch (err) {
                console.log(`Error inserting relations: ${err}.`);
            }
        }
        const toDelete = existing.filter(r => !topicCategoryValues.some(v => v.topicId == r.topicId && v.categoryId == r.categoryId));


        ctx.logger.pino.info({count: toDelete.length}, "deleting old category relations")

        try {
            if(toDelete.length > 0) {
                for (let i = 0; i < toDelete.length; i += batchSize) {
                    const chunk = toDelete.slice(i, i + batchSize);
                    try {
                        await trx
                            .deleteFrom('TopicToCategory')
                            .where(({eb, refTuple, tuple}) =>
                                eb(
                                    refTuple('topicId', 'categoryId'),
                                    'in',
                                    chunk.map((r) => tuple(r.topicId, r.categoryId))
                                )
                            )
                            .execute();
                    } catch (err) {
                        ctx.logger.pino.error({error: err}, "error deleting old relations")
                        console.log({error: err},  `error deleting batch`);
                    }
                }
            }
        } catch (err) {
            ctx.logger.pino.error({error: err}, "error deleting old category relations")
        }

        await trx
            .deleteFrom("TopicCategory")
            .where(
                "id",
                "not in",
                trx.selectFrom("TopicToCategory").select("categoryId")
            )
            .execute()
    })

    ctx.logger.logTimes("update-topic-categories done", [t1, Date.now()])
}



