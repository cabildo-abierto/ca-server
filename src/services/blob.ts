import {DidResolver} from "@atproto/identity";
import {SessionAgent} from "#/utils/session-agent";
import {ImagePayload} from "#/services/write/post";
import {AppContext} from "#/index";
import {BlobRef} from "#/services/hydration/hydrate";
import {getBlobKey} from "#/services/hydration/dataplane";
import {redisCacheTTL} from "#/services/wiki/topics";
import {imageSize} from "image-size";


export async function getServiceEndpointForDid(did: string){
    try {
        const didres: DidResolver = new DidResolver({})
        const doc = await didres.resolve(did)
        if(doc && doc.service && doc.service.length > 0 && doc.service[0].serviceEndpoint){
            return doc.service[0].serviceEndpoint
        }
    } catch (e) {
        console.error("Error getting service endpoint", e)
        return null
    }
    return null
}


export async function getBlobUrl(blob: {cid: string, authorId: string}){
    let serviceEndpoint = await getServiceEndpointForDid(blob.authorId)

    if(serviceEndpoint && serviceEndpoint.toString() != "undefined"){
        return serviceEndpoint + "/xrpc/com.atproto.sync.getBlob?did=" + blob.authorId + "&cid=" + blob.cid
    }
    return null
}


export async function fetchBlob(blob: {cid: string, authorId: string}) {
    let serviceEndpoint = await getServiceEndpointForDid(blob.authorId)
    if (serviceEndpoint) {
        const url = serviceEndpoint + "/xrpc/com.atproto.sync.getBlob?did=" + blob.authorId + "&cid=" + blob.cid
        try {
            return await fetch(url)
        } catch {
            console.error("Couldn't fetch blob", blob.cid, blob.authorId)
            return null
        }
    }
    return null
}


export async function fetchTextBlob(ref: {cid: string, authorId: string}, retries: number = 0) {
    const res = await fetchBlob(ref)
    if(!res || res.status != 200) {
        if(retries > 0) {
            console.log(`Retrying... (${retries-1} retries left)`)
            return fetchTextBlob(ref, retries - 1)
        } else {
            return null
        }
    }
    const blob = await res.blob()
    return await blob.text()
}


export async function fetchTextBlobs(ctx: AppContext, blobs: BlobRef[], retries: number = 0): Promise<(string | null)[]> {
    if(blobs.length == 0) return []
    const keys: string[] = blobs.map(b => getBlobKey(b))

    const blobContents: (string | null)[] = await ctx.ioredis.mget(keys)

    const pending: {i: number, blob: BlobRef}[] = []
    for(let i = 0; i < blobContents.length; i++){
        if(!blobContents[i]){
            pending.push({i, blob: blobs[i]})
        }
    }

    const res = await Promise.all(pending.map(p => fetchTextBlob(p.blob, retries)))

    for(let i = 0; i < pending.length; i++){
        const r = res[i]
        if(r){
            blobContents[pending[i].i] = r
        } else {
            console.log("Warning: Couldn't find blob:", pending[i].blob)
        }
    }

    const pipeline = ctx.ioredis.pipeline()
    for(let i = 0; i < pending.length; i++){
        const b = res[i]
        const k = getBlobKey(pending[i].blob)
        if(b) pipeline.set(k, b, 'EX', redisCacheTTL)
    }
    await pipeline.exec()

    return blobContents
}


export async function uploadStringBlob(agent: SessionAgent, s: string, encoding?: string){
    const encoder = new TextEncoder()
    const uint8 = encoder.encode(s)
    const res = await agent.bsky.uploadBlob(uint8, {encoding})
    return res.data.blob
}


export async function uploadImageSrcBlob(agent: SessionAgent, src: string){
    const response = await fetch(src)
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const res = await agent.bsky.uploadBlob(uint8)
    return {ref: res.data.blob, size: imageSize(uint8)}
}


export async function uploadBase64Blob(agent: SessionAgent, base64: string){
    const base64Data = base64.replace(/^data:.*?;base64,/, '');
    const arrayBuffer = Buffer.from(base64Data, "base64")
    const uint8 = new Uint8Array(arrayBuffer);
    const res = await agent.bsky.uploadBlob(uint8)
    return {ref: res.data.blob, size: imageSize(uint8)}
}


export async function uploadImageBlob(agent: SessionAgent, image: ImagePayload){
    if(image.$type == "url") {
        return await uploadImageSrcBlob(agent, image.src)
    } else {
        return await uploadBase64Blob(agent, image.base64)
    }
}

