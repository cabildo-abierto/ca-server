import {processArticle} from "#/services/sync/process-event";
import {uploadStringBlob} from "#/services/blob";
import {CAHandler} from "#/utils/handler";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {SessionAgent} from "#/utils/session-agent";
import {getTopicsMentioned} from "#/services/wiki/topics";
import {Transaction} from "kysely";
import {DB, ReferenceType} from "../../../prisma/generated/types";
import {v4 as uuidv4} from 'uuid'
import {ATProtoStrongRef} from "#/lib/types";
import {TopicMention} from "#/lex-api/types/ar/cabildoabierto/feed/defs"
import {ArticleEmbedView} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {EmbedContext, getEmbedsFromEmbedViews} from "#/services/write/topic";

export type CreateArticleProps = {
    title: string
    format: string
    text: string
    enDiscusion: boolean
    embeds?: ArticleEmbedView[]
    embedContexts?: EmbedContext[]
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

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        repo: did,
        collection: 'ar.cabildoabierto.feed.article',
        record: record,
    })

    return {ref: {uri: data.uri, cid: data.cid}, record}
}

export const createArticle: CAHandler<CreateArticleProps> = async (ctx, agent, article) => {
    let ref: ATProtoStrongRef
    let record: ArticleRecord
    let mentions: TopicMention[] | undefined
    try {
        const [res, {data}] = await Promise.all([
            createArticleAT(agent, article),
            getTopicsMentioned(ctx, agent, article)
        ])
        if(res.error || !res.ref || !res.record) return {error: res.error}

        ref = res.ref
        record = res.record
        mentions = data
    } catch (err) {
        return {error: "Ocurrió un error al publicar el artículo."}
    }

    const afterTransaction = mentions && mentions.length > 0 ? async (trx: Transaction<DB>) => {

        const values = mentions.map(m => {
            return {
                id: uuidv4(),
                referencedTopicId: m.id,
                referencingContentId: ref.uri,
                type: "Weak" as ReferenceType,
                count: m.count
            }
        })

        await trx
            .insertInto("Reference")
            .values(values)
            .execute()

    } : undefined

    try {
        await processArticle(ctx, ref, record, afterTransaction)
    } catch (err) {
        console.error(err)
        return {
            error: "El artículo se publicó, pero hubo un error al procesarlo. Si no lo ves publicado dentro de unas horas, comunicate con el soporte."
        }
    }

    return {data: {}}
}