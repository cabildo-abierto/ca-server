import {AppContext} from "#/index";
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
                .values(allCategoryIds.map((id) => ({id})))
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
        const batchSize = 500;

        console.log("Inserting new relations")

        for(let i = 0; i < topicCategoryValues.length; i += batchSize) {
            console.log(`Batch ${i}.`)
            console.log(topicCategoryValues.slice(i, i + batchSize).slice(0, 5))
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

        console.log("Deleting old relations", toDelete.length)
        try {
            if(toDelete.length > 0) {
                for (let i = 0; i < toDelete.length; i += batchSize) {
                    console.log(`Deleting batch starting at ${i} of ${toDelete.length} relations.`)
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
                        console.log(`Error deleting batch: ${err}.`);
                    }
                }
            }
        } catch (err) {
            console.log("Error deleting old relations", err)
        }
    })





    console.log('Done after', Date.now() - t1);
}



