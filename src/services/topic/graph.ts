import {getCategories} from "./topics";
import {AppContext} from "#/index";
import {TopicsGraph} from "#/lib/types";
import {logTimes} from "#/utils/utils";
import {CAHandler} from "#/utils/handler";
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {getTopicCategories} from "#/services/topic/utils";



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


export const updateCategoriesGraphHandler: CAHandler<{}, {}> = async (ctx, agent, {}) => {
    console.log("Updating categories graph queued.")
    await ctx.queue.add("update-categories-graph", null)
    return {data: {}}
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
            })).filter(e => e.x != e.y),
            nodeLabels: Array.from(nodeLabels.entries()).map(([a, b]) => ({
                id: a, label: b
            }))
        }
    }
}


export const getCategoryGraph: CAHandler<{params: {c: string}}, TopicsGraph> = async (ctx, agent, {params}) => {
    // TO DO: Usar props en vez de categories (que ya no se actualiza)
    const t1 = Date.now()
    const {c: cat} = params

    let topics: {
        id: string
        referencedBy: {
            referencingContent: {
                topicVersion: {
                    topicId: string
                } | null
            }
        }[]
    }[]

    if(cat == "Sin categoría"){
        topics = await ctx.db.topic.findMany({
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
                    none: {}
                }
            },
            take: 500
        })
    } else {
        topics = await ctx.db.topic.findMany({
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
            },
            take: 500
        })
    }
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
                if(xId == yId) continue

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
            nodeIds: topics.map(t => t.id),
                edges: edges.slice(0, 300)
        }
    }
}
