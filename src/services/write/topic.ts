import {processCreate} from "../sync/process-event";
import {SessionAgent} from "#/utils/session-agent";
import {CAHandler} from "#/utils/handler";
import {TopicProp, validateTopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {uploadStringBlob} from "#/services/blob";
import {BlobRef} from "@atproto/lexicon";
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";


export async function createTopicVersionATProto(agent: SessionAgent, {id, text, format, message, props}: CreateTopicVersionProps){
    let blob: BlobRef | null = null

    if(text){
        blob = await uploadStringBlob(agent, text)
    }

    if(text && !blob) return {error: "Ocurrió un error al publicar el tema."}

    console.log("Creating topic version with blob", blob)
    const record: TopicVersionRecord = {
        $type: "ar.cabildoabierto.wiki.topicVersion",
        text: text && blob ? blob : undefined,
        format,
        message,
        id,
        props: props && !props.some(p => !validateTopicProp(p).success) ? props : undefined,
        createdAt: new Date().toISOString()
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
}


export const createTopicVersion: CAHandler<CreateTopicVersionProps> = async (ctx, agent, params) => {
    const {error, ref, record} = await createTopicVersionATProto(agent, params)
    if(!error && ref && record){
        const updates = await processCreate(ctx, ref, record)
        await ctx.db.$transaction(updates)
    }
    return {error}
}