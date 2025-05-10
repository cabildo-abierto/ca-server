import {processCreate} from "#/services/sync/process-event";
import {uploadStringBlob} from "#/services/blob";
import {CAHandler} from "#/utils/handler";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {SessionAgent} from "#/utils/session-agent";
import {getTopicsMentioned} from "#/services/topic/topics";

export type CreateArticleProps = {
    title: string
    format: string
    text: string
    enDiscusion: boolean
}

export const createArticleAT = async (agent: SessionAgent, article: CreateArticleProps) => {
    const did = agent.did
    const text = article.text
    const blobRef = await uploadStringBlob(agent, text)

    const record: ArticleRecord = {
        "$type": "ar.cabildoabierto.feed.article",
        title: article.title,
        format: article.format,
        text: blobRef,
        createdAt: new Date().toISOString(),
        labels: article.enDiscusion ? {$type: "com.atproto.label.defs#selfLabels", values: [{val: "ca:en discusión"}]} : undefined
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        repo: did,
        collection: 'ar.cabildoabierto.feed.article',
        record: record,
    })

    return {ref: {uri: data.uri, cid: data.cid}, record}
}

export const createArticle: CAHandler<CreateArticleProps> = async (ctx, agent, article) => {
    try {
        const [{ref, record}, {data: mentions}] = await Promise.all([
            createArticleAT(agent, article),
            getTopicsMentioned(ctx, agent, article)
        ])

        const updates = await processCreate(ctx, ref, record)

        if(mentions && mentions.length > 0){
            updates.push(ctx.db.reference.createMany({
                data: mentions.map(m => ({
                    referencedTopicId: m.id,
                    referencingContentId: ref.uri,
                    type: "Weak",
                    count: m.count
                }))
            }))
        }

        await ctx.db.$transaction(updates)
        return {data: {}}
    } catch (err) {
        console.error("Error", err)
        return {error: "Ocurrió un error al publicar el artículo."}
    }

}