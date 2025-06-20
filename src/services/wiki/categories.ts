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

    console.log("topic categories", topicCategories)

    const t1 = Date.now();

    const allCategoryIds = [
        ...new Set(topicCategories.flatMap(({categoryIds}) => categoryIds))
    ];

    if (allCategoryIds.length === 0) {
        console.log('No categories to update.');
        return;
    }

    await ctx.kysely.transaction().execute(async (trx) => {
        console.log('Inserting categories.');
        await ctx.kysely
            .insertInto('TopicCategory')
            .values(allCategoryIds.map((id) => ({id})))
            .onConflict((oc) => oc.column('id').doNothing())
            .execute();

        const topicCategoryValues = topicCategories.flatMap(({topicId, categoryIds}) =>
            categoryIds.map((categoryId) => ({
                topicId,
                categoryId
            }))
        );
        console.log("topic-category values",
            topicCategoryValues.length,
            topicCategoryValues.slice(0, 20)
        )

        if (topicCategoryValues.length === 0) {
            console.log('No topic-category relationships to update.');
            return;
        }

        console.log(topicCategoryValues.slice(0, 20))

        let existing: {topicId: string, categoryId: string}[] = []
        try {
            existing = await ctx.kysely
                .selectFrom('TopicToCategory')
                .select(['topicId', 'categoryId'])
                .execute();
        } catch (err) {
            console.log("Error getting existing relations", err)
            return
        }

        console.log("Inserting new relations")
        await ctx.kysely
            .insertInto('TopicToCategory')
            .values(topicCategoryValues)
            .onConflict((oc) => oc.columns(['topicId', 'categoryId']).doNothing())
            .execute();

        const toDelete = existing.filter(r => !topicCategoryValues.some(v => v.topicId == r.topicId && v.categoryId == r.categoryId));

        console.log("Deleting old relations", toDelete.length)
        try {
            const batch_size = 500;
            for (let i = 0; i < toDelete.length; i += batch_size) {
                console.log(`Deleting batch starting at ${i} of ${toDelete.length} relations.`)
                const chunk = toDelete.slice(i, i + batch_size);
                await ctx.kysely
                    .deleteFrom('TopicToCategory')
                    .where(({eb, refTuple, tuple}) =>
                        eb(
                            refTuple('topicId', 'categoryId'),
                            'not in',
                            chunk.map((r) => tuple(r.topicId, r.categoryId))
                        )
                    )
                    .execute();
            }
        } catch (err) {
            console.log("Error deleting old relations", err)
        }
    })


    console.log('Done after', Date.now() - t1);
}



