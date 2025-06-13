import {processTopicVersion} from "../sync/process-event";
import {SessionAgent} from "#/utils/session-agent";
import {CAHandler} from "#/utils/handler";
import {TopicProp, validateTopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {uploadBase64Blob, uploadStringBlob} from "#/services/blob";
import {BlobRef} from "@atproto/lexicon";
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {ArticleEmbedView, ArticleEmbed} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {isView as isImagesEmbedView, Image} from "#/lex-api/types/app/bsky/embed/images"
import {isMain as isVisualizationEmbed} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"


export async function getEmbedsFromEmbedViews(agent: SessionAgent, embeds?: ArticleEmbedView[], embedContexts?: EmbedContext[]): Promise<{data?: ArticleEmbed[], error?: string}> {
    let embedMains: ArticleEmbed[] = []
    if(embeds){
        for(let i = 0; i < embeds.length; i++){
            const e = embeds[i]
            if(isImagesEmbedView(e.value)){
                if(embedContexts && embedContexts[i]){
                    const context = embedContexts[i]
                    if(context?.base64files){
                        const blobs = await Promise.all(context.base64files.map(f => uploadBase64Blob(agent, f)))
                        const images: Image[] = []
                        for(let j = 0; j < blobs.length; j++){
                            const b = blobs[j]
                            images.push({
                                $type: "app.bsky.embed.images#image",
                                image: b.ref,
                                alt: ""
                            })
                        }
                        embedMains.push({
                            $type: "ar.cabildoabierto.feed.article#articleEmbed",
                            value: {
                                $type: "app.bsky.embed.images",
                                images
                            },
                            index: e.index
                        })
                    }
                } else {
                    const images: Image[] = []
                    for(let j = 0; j < e.value.images.length; j++){
                        const img = e.value.images[j]
                        const url = img.fullsize && img.fullsize.length > 0 ? img.fullsize : img.thumb
                        const res = await fetch(url)
                        if(!res.ok){
                            return {error: "No se encontró la imagen."}
                        }
                        const blob = await res.blob();
                        const arrayBuffer = await blob.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        const base64 = buffer.toString('base64');
                        const blobRef = await uploadBase64Blob(agent, base64)
                        images.push({
                            $type: "app.bsky.embed.images#image",
                            image: blobRef.ref,
                            alt: ""
                        })
                    }
                    embedMains.push({
                        $type: "ar.cabildoabierto.feed.article#articleEmbed",
                        value: {
                            $type: "app.bsky.embed.images",
                            images
                        },
                        index: e.index
                    })
                }
            } else if(isVisualizationEmbed(e.value)){
                embedMains.push({
                    $type: "ar.cabildoabierto.feed.article#articleEmbed",
                    value: e.value,
                    index: e.index
                })
            }
        }
    }
    return {data: embedMains}
}


export async function createTopicVersionATProto(agent: SessionAgent, {id, text, format, message, props, embeds, embedContexts, claimsAuthorship}: CreateTopicVersionProps){
    let blob: BlobRef | null = null

    if(text){
        blob = await uploadStringBlob(agent, text)
    }

    if(text && !blob) return {error: "Ocurrió un error al publicar el tema."}

    let validatedProps: TopicProp[] | undefined = undefined
    if(props){
        validatedProps = []
        for(let i = 0; i < props.length; i++){
            const res = validateTopicProp(props[i])
            if(!res.success){
                console.log("Propiedad inválida:", props[i])
                if(props[i].name){
                    return {error: `Ocurrió un error al validar la propiedad: ${props[i].name}`}
                }
                return {error: "Ocurrió un error al validar una propiedad."}
            } else {
                validatedProps.push(res.value)
            }
        }
    }

    const embedMains = await getEmbedsFromEmbedViews(agent, embeds, embedContexts)
    if(embedMains.error){
        return {error: embedMains.error}
    }

    const record: TopicVersionRecord = {
        $type: "ar.cabildoabierto.wiki.topicVersion",
        text: text && blob ? blob : undefined,
        format,
        message,
        id,
        props: validatedProps,
        createdAt: new Date().toISOString(),
        embeds: embedMains.data,
        claimsAuthorship: claimsAuthorship
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        repo: agent.did,
        collection: 'ar.cabildoabierto.wiki.topicVersion',
        record: record,
    })
    return {ref: {uri: data.uri, cid: data.cid}, record}
}


export type EmbedContext = {
    base64files?: string[]
} | null


type CreateTopicVersionProps = {
    id: string
    text?: string
    format?: string,
    props?: TopicProp[]
    message?: string,
    claimsAuthorship?: boolean
    embeds?: ArticleEmbedView[]
    embedContexts?: EmbedContext[]
}


export const createTopicVersion: CAHandler<CreateTopicVersionProps> = async (ctx, agent, params) => {
    const {error, ref, record} = await createTopicVersionATProto(agent, params)
    if(!error && ref && record){
        await processTopicVersion(ctx, ref, record)
    }
    return {error}
}