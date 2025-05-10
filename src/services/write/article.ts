import {processCreate} from "#/services/sync/process-event";
import {uploadStringBlob} from "#/services/blob";
import {CAHandler} from "#/utils/handler";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article";

export type CreateArticleProps = {
    title: string
    format: string
    text: string
    enDiscusion: boolean
}

export const createArticle: CAHandler<CreateArticleProps> = async (ctx, agent, article) => {
    const did = agent.did
    const text = article.text

    try {
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

        const {uri, cid} = data
        const updates = await processCreate(ctx, {uri, cid}, record)

        await ctx.db.$transaction(updates)
        return {data: {}}
    } catch (err) {
        console.error("Error", err)
        return {error: "Ocurrió un error al publicar el artículo."}
    }

}