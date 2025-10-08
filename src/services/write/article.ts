import {uploadStringBlob} from "#/services/blob.js";
import {CAHandler} from "#/utils/handler.js";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article.js";
import {SessionAgent} from "#/utils/session-agent.js";
import {ArticleEmbedView} from "#/lex-api/types/ar/cabildoabierto/feed/article.js";
import {EmbedContext, getEmbedsFromEmbedViews} from "#/services/write/topic.js";
import {ArticleRecordProcessor} from "#/services/sync/event-processing/article.js";
import {getRkeyFromUri} from "#/utils/uri.js";
import {deleteRecords} from "#/services/delete.js";
import {isContentReferenced} from "#/services/write/post.js";

export type CreateArticleProps = {
    title: string
    format: string
    text: string
    enDiscusion: boolean
    embeds?: ArticleEmbedView[]
    embedContexts?: EmbedContext[]
    draftId?: string
    uri?: string
}

export const createArticleAT = async (agent: SessionAgent, article: CreateArticleProps) => {
    const did = agent.did
    const text = article.text
    const blobRef = await uploadStringBlob(agent, text)

    const embedMains = await getEmbedsFromEmbedViews(agent, article.embeds, article.embedContexts)
    if(embedMains.error){
        return {error: embedMains.error}
    }

    const record: ArticleRecord = {
        "$type": "ar.cabildoabierto.feed.article",
        title: article.title,
        format: article.format,
        text: blobRef,
        createdAt: new Date().toISOString(),
        embeds: embedMains.data,
        labels: article.enDiscusion ? {$type: "com.atproto.label.defs#selfLabels", values: [{val: "ca:en discusión"}]} : undefined
    }

    if(!article.uri) {
        const {data} = await agent.bsky.com.atproto.repo.createRecord({
            repo: did,
            collection: 'ar.cabildoabierto.feed.article',
            record: record,
        })
        return {ref: {uri: data.uri, cid: data.cid}, record}
    } else {
        const {data} = await agent.bsky.com.atproto.repo.putRecord({
            repo: did,
            collection: 'ar.cabildoabierto.feed.article',
            rkey: getRkeyFromUri(article.uri),
            record: record,
        })
        return {ref: {uri: data.uri, cid: data.cid}, record}
    }

}

export const createArticle: CAHandler<CreateArticleProps> = async (ctx, agent, article) => {
    if(article.uri) {
        // se está editando un artículo
        const {data: referenced, error} = await isContentReferenced(ctx, article.uri)
        if(error) return {error}
        if(referenced){
            return {error: "El artículo ya fue referenciado y no se puede editar. Si querés, podés eliminarlo."}
        } else {
            await deleteRecords({ctx, agent, uris: [article.uri], atproto: true})
        }
    }


    try {
        const res = await createArticleAT(agent, article)
        if(res.error || !res.ref || !res.record) return {error: res.error}

        await Promise.all([
            article.draftId ? ctx.kysely
                .deleteFrom("Draft")
                .where("id", "=", article.draftId)
                .execute() : undefined,
            new ArticleRecordProcessor(ctx).processValidated([res])
        ])
    } catch (e) {
        ctx.logger.pino.error({error: e}, "error al publicar arículo")
        return {error: "Ocurrió un error al publicar el artículo."}
    }

    return {data: {}}
}