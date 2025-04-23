import {AppContext} from "#/index";


export function currentCategories(topic: {
    versions: { categories: string | null, content: { record: { createdAt: Date } } }[]
}) {
    let last = null
    for (let i = 0; i < topic.versions.length; i++) {
        if (topic.versions[i].categories != null) {
            const date = new Date(topic.versions[i].content.record.createdAt).getTime()
            if (last == null || new Date(topic.versions[last].content.record.createdAt).getTime() < date) {
                last = i
            }
        }
    }
    if (last == null) return []

    const lastCat = topic.versions[last].categories
    return lastCat ? (JSON.parse(lastCat) as string[]) : []
}


export function setTopicCategories(ctx: AppContext, topicId: string, categories: string[]){
    let updates = []
    updates.push(ctx.db.topicToCategory.deleteMany({
        where: { topicId: topicId }
    }))

    updates.push(ctx.db.topic.update({
        where: { id: topicId },
        data: {
            categories: {
                create: categories.map(cat => ({
                    category: {
                        connectOrCreate: {
                            where: { id: cat },
                            create: { id: cat }
                        }
                    }
                }))
            }
        }
    }))
    return updates
}


export function setTopicSynonyms(ctx: AppContext, topicId: string, synonyms: string[]){
    return [ctx.db.topic.update({
        data: {
            synonyms
        },
        where: { id: topicId }
    })]
}