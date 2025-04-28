import {getCategories} from "./topics";
import {AppContext} from "#/index";
import {TopicsGraph} from "#/lib/types";
import {logTimes} from "#/utils/utils";
import {CAHandler} from "#/utils/handler";


export async function updateCategoriesGraph(ctx: AppContext) {
    let topics = await ctx.db.topic.findMany({
        select: {
            id: true,
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
        const cats = topics[i].categories.map(({categoryId}) => (categoryId))
        topicToCategoriesMap.set(topics[i].id, cats)
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

    await ctx.db.$transaction([
        ctx.db.categoryLink.deleteMany(),
        ctx.db.categoryLink.createMany({
            data: edges.map(e => ({
                idCategoryA: e.x,
                idCategoryB: e.y
            }))
        })
    ])
    // revalidateTag("categoriesgraph")
}


export const getCategoriesGraph: CAHandler<{}, TopicsGraph> = async (ctx, agent, {}) => {
    const links = await ctx.db.categoryLink.findMany({
        select: {
            idCategoryA: true,
            idCategoryB: true
        }
    })

    const {data: categories, error} = await getCategories(ctx, agent, {})
    if(!categories){
        return {error}
    }

    const nodeIds = categories.map(cat => cat.category)

    const nodeLabels = new Map<string, string>()
    categories.forEach(({category, size}) => {
        nodeLabels.set(category, category + " (" + size + ")")
    })

    return {
        data: {
            nodeIds: Array.from(nodeIds),
            edges: links.map(l => ({
                x: l.idCategoryA,
                y: l.idCategoryB
            })),
            nodeLabels: Array.from(nodeLabels.entries()).map(([a, b]) => ({
                id: a, label: b
            }))
        }
    }
}


export const getCategoryGraph: CAHandler<{params: {c: string}}, TopicsGraph> = async (ctx, agent, {params}) => {
    const t1 = Date.now()
    const {c: cat} = params
    let topics = await ctx.db.topic.findMany({
        select: {
            id: true,
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
        },
        where: {
            categories: {
                some: {categoryId: cat}
            }
        }
    })
    const t2 = Date.now()

    const topicIdsSet = new Set(topics.map(t => t.id))

    const edges = []
    for (let i = 0; i < topics.length; i++) {
        const yId = topics[i].id

        for (let j = 0; j < topics[i].referencedBy.length; j++) {
            if (topics[i].referencedBy[j].referencingContent.topicVersion) {
                const v = topics[i].referencedBy[j].referencingContent.topicVersion
                if (!v) continue
                const xId = v.topicId
                if (!topicIdsSet.has(xId)) continue

                edges.push({
                    x: xId,
                    y: yId,
                })
            }
        }
    }
    const t3 = Date.now()

    logTimes("get category " + cat, [t1, t2, t3])
    return {
        data: {
            nodeIds: topics.slice(0, 500).map(t => t.id),
                edges: edges.slice(0, 100)
        }
    }
}
