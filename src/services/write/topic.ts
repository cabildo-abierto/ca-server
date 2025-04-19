import {processCreateRecordFromRefAndRecord} from "../sync/process-event";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {logTimes} from "#/utils/utils";


export async function createTopic(ctx: AppContext, agent: SessionAgent, id: string){
    // TO DO: Chequear que no exista el tema.
    return await createTopicVersion({
        ctx,
        agent,
        id,
        claimsAuthorship: true,
        text: ""
    })
}


export async function createTopicVersionATProto({
    agent, id, text, format="markdown", title, message, categories, synonyms
}: {
    agent: SessionAgent,
    id: string,
    text?: FormData | string,
    format?: string,
    title?: string
    message?: string
    categories?: string[]
    synonyms?: string[]
}){
    let blob = null
    if(text && typeof text != "string"){
        const data = Object.fromEntries(text);
        let f = data.data as File
        const headers: Record<string, string> = {
            "Content-Length": f.size.toString()
        }
        const res = await agent.bsky.uploadBlob(f, {headers})
        blob = res.data.blob
    }

    const record = {
        "$type": "ar.com.cabildoabierto.topic",
        text: blob ? {
            ref: blob.ref,
            mimeType: blob.mimeType,
            size: blob.size,
            $type: "blob"
        } : text,
        title,
        format,
        message,
        categories: categories ? JSON.stringify(categories) : undefined,
        synonyms: synonyms ? JSON.stringify(synonyms) : undefined,
        id,
        createdAt: new Date().toISOString()
    }

    try {
        const {data} = await agent.bsky.com.atproto.repo.createRecord({
            repo: agent.did,
            collection: 'ar.com.cabildoabierto.topic',
            record: record,
        })
        return {ref: {uri: data.uri, cid: data.cid}, record}
    } catch (e) {
        console.error("error", e)
        return {error: "Ocurrió un error al publicar en ATProto."}
    }
}


export async function createTopicVersion({ctx, agent, id, text, format="markdown", title, message, categories, synonyms}: {
    ctx: AppContext,
    agent: SessionAgent,
    id: string,
    text?: FormData | string,
    format?: string,
    title?: string
    claimsAuthorship: boolean
    message?: string
    categories?: string[]
    synonyms?: string[]
}): Promise<{error?: string}>{
    const t1 = Date.now()
    const {ref, record} = await createTopicVersionATProto({
        agent, id, text, format, title, message, categories, synonyms
    })
    const t2 = Date.now()
    if(ref){
        const {updates} = await processCreateRecordFromRefAndRecord(ctx, ref, record)
        await ctx.db.$transaction(updates)
        // await revalidateTags(Array.from(tags))
    }
    const t3 = Date.now()
    logTimes("create topic version " + id, [t1, t2, t3])
    return {}
}


export async function updateCategoriesInTopic({ctx, agent, topicId, categories}: {ctx: AppContext, agent: SessionAgent, topicId: string, categories: string[]}) {
    const res = await createTopicVersion({
        ctx,
        agent,
        id: topicId,
        categories,
        claimsAuthorship: false,
    })
    // revalidateTag("categories")
    // revalidateTag("topics")
    return res
}


export async function updateSynonymsInTopic({ctx, agent, topicId, synonyms}: {ctx: AppContext, agent: SessionAgent, topicId: string, synonyms: string[]}) {

    return await createTopicVersion({
        ctx,
        agent,
        id: topicId,
        synonyms,
        claimsAuthorship: false,
    })
}