import {CreateArticleProps} from "#/routes/article";
import {splitUri} from "#/utils/uri";
import {processCreateRecord} from "#/services/sync/process-event";
import {uploadStringBlob} from "#/services/blob";
import {CAHandler} from "#/utils/handler";


export const createArticle: CAHandler<CreateArticleProps> = async (ctx, agent, article) => {
    const did = agent.did
    const text = article.text

    try {
        const blobRef = await uploadStringBlob(agent, text)

        const record = {
            "$type": "ar.cabildoabierto.feed.article",
            title: article.title,
            format: article.format,
            text: {
                ref: blobRef.ref,
                mimeType: blobRef.mimeType,
                size: blobRef.size,
                $type: "blob"
            },
            createdAt: new Date().toISOString()
        }

        const {data} = await agent.bsky.com.atproto.repo.createRecord({
            repo: did,
            collection: 'ar.cabildoabierto.feed.article',
            record: record,
        })

        const {uri, cid} = data
        const {updates} = await processCreateRecord(ctx, {
            uri,
            cid,
            ...splitUri(uri),
            record
        })

        await ctx.db.$transaction(updates)
    } catch (err){
        console.error("Error", err)
        return {error: "Ocurrió un error al publicar el artículo."}
    }

    return {}
}