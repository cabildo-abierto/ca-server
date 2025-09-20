import {getCategoriesWithCounts} from "./topics";
import {AppContext} from "#/setup";
import {TopicsGraph} from "#/lib/types";
import {logTimes} from "#/utils/utils";
import {CAHandlerNoAuth} from "#/utils/handler";
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicCategories} from "#/services/wiki/utils";
import {stringListIncludes, stringListIsEmpty} from "#/services/dataset/read";


export const updateCategoriesGraph = async (ctx: AppContext) => {
    // TO DO: Actualizar también las categorías o usar el json
    console.log("Getting topics.")

    let topics = await ctx.db.topic.findMany({
        select: {
            id: true,
            currentVersion: {
                select: {
                    props: true,
                    categories: true
                }
            },
            categories: {
                select: {
                    categoryId: true
                }
            },
            referencedBy: {
                select: {
                    referencingContent: {
                        select: {
                            topicVersion: {
                                select: {
                                    topicId: true
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    const topicToCategoriesMap = new Map<string, string[]>()

    const categories = new Map<string, number>()
    for (let i = 0; i < topics.length; i++) {
        const t = topics[i]
        const cats = getTopicCategories(
            t.currentVersion?.props as unknown as TopicProp[] | undefined,
            t.categories.map(c => c.categoryId),
            t.currentVersion?.categories ?? undefined
        )
        topicToCategoriesMap.set(t.id, cats)
        cats.forEach((c) => {
            const y = categories.get(c)
            if (!y) categories.set(c, 1)
            else categories.set(c, y + 1)
        })
    }

    const edges: { x: string, y: string }[] = []
    for (let i = 0; i < topics.length; i++) {
        const yId = topics[i].id
        const catsY = topicToCategoriesMap.get(yId)
        if (!catsY) continue

        for (let j = 0; j < topics[i].referencedBy.length; j++) {
            if (topics[i].referencedBy[j].referencingContent.topicVersion) {
                const v = topics[i].referencedBy[j].referencingContent.topicVersion
                if (!v) continue
                const xId = v.topicId
                const catsX = topicToCategoriesMap.get(xId)
                if (!catsX) continue

                catsX.forEach((catX) => {
                    catsY.forEach((catY) => {
                        if (catX != catY && !edges.some(({x, y}) => (x == catX && y == catY))) {
                            edges.push({x: catX, y: catY})
                        }
                    })
                })
            }
        }
    }

    console.log("Applying changes.")
    await ctx.db.$transaction([
        ctx.db.categoryLink.deleteMany(),
        ctx.db.categoryLink.createMany({
            data: edges.map(e => ({
                idCategoryA: e.x,
                idCategoryB: e.y
            }))
        })
    ])

    console.log("Done.")
    // revalidateTag("categoriesgraph")
}

export const getCategoriesGraph: CAHandlerNoAuth<{}, TopicsGraph> = async (ctx, agent, {}) => {
    const links = await ctx.db.categoryLink.findMany({
        select: {
            idCategoryA: true,
            idCategoryB: true
        }
    })

    const {data: categories, error} = await getCategoriesWithCounts(ctx, agent, {})
    if (!categories) {
        return {error}
    }

    const nodeIds = categories.map(cat => cat.category)

    const data = categories.map(c => ({id: c.category, categorySize: c.size}))

    return {
        data: {
            nodeIds: Array.from(nodeIds),
            edges: links.map(l => ({
                x: l.idCategoryA,
                y: l.idCategoryB
            })).filter(e => e.x != e.y),
            data
        }
    }
}


export const getCategoryGraph: CAHandlerNoAuth<{ query: { c: string[] | string } }, TopicsGraph> = async (ctx, agent, {query}) => {
    const categories = typeof query.c == "string" ? [query.c] : query.c

    const baseQuery = ctx.kysely
            .with("Node", db => db
                .selectFrom("Topic")
                .innerJoin("TopicVersion", "TopicVersion.uri", "Topic.currentVersionId")
                .select(["id", "currentVersionId"])
                .where(categories.includes("Sin categoría") ?
                    stringListIsEmpty("Categorías") :
                    eb =>
                        eb.and(
                            categories.map(c => stringListIncludes("Categorías", c))
                        )
                )
            )

    const t1 = Date.now()
    const [nodeIds, edges] = await Promise.all([
        baseQuery
            .selectFrom("Node")
            .select(["Node.id"])
            .execute(),
        baseQuery
            .selectFrom('Node as Node1')
            .innerJoin("Reference", "Reference.referencedTopicId", "Node1.id")
            .innerJoin("Node as Node2", "Reference.referencingContentId", "Node2.currentVersionId")
            .select(['Node1.id as x', "Node2.id as y"])
            .execute()
    ])

    logTimes(`get cateogory graph ${categories}`, [t1, Date.now()])

    return {
        data: {
            nodeIds: nodeIds.map(t => t.id),
            edges
        }
    }
}
