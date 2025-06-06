import {processCreate, processTopicVersion} from "../sync/process-event";
import {SessionAgent} from "#/utils/session-agent";
import {CAHandler} from "#/utils/handler";
import {TopicProp, validateTopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {uploadStringBlob} from "#/services/blob";
import {BlobRef} from "@atproto/lexicon";
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {ArticleEmbed} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {isTopicProp, isNumberProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"


export async function createTopicVersionATProto(agent: SessionAgent, {id, text, format, message, props, embeds}: CreateTopicVersionProps){
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

    const record: TopicVersionRecord = {
        $type: "ar.cabildoabierto.wiki.topicVersion",
        text: text && blob ? blob : undefined,
        format,
        message,
        id,
        props: validatedProps,
        createdAt: new Date().toISOString(),
        embeds: embeds ?? []
    }

    const {data} = await agent.bsky.com.atproto.repo.createRecord({
        repo: agent.did,
        collection: 'ar.cabildoabierto.wiki.topicVersion',
        record: record,
    })
    return {ref: {uri: data.uri, cid: data.cid}, record}
}


type CreateTopicVersionProps = {
    id: string
    text?: string
    format?: string,
    props?: TopicProp[]
    message?: string,
    claimsAuthorship?: boolean
    embeds?: ArticleEmbed[]
}


export const createTopicVersion: CAHandler<CreateTopicVersionProps> = async (ctx, agent, params) => {
    const {error, ref, record} = await createTopicVersionATProto(agent, params)
    if(!error && ref && record){
        await processTopicVersion(ctx, ref, record)
    }
    return {error}
}