import {DidResolver} from "@atproto/identity";
import {SessionAgent} from "#/utils/session-agent";
import {ImagePayload} from "#/routes/post";


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
        } catch (e) {
            console.error("Couldn't fetch blob", blob.cid, blob.authorId)
            return null
        }
    }
    return null
}


export async function uploadStringBlob(agent: SessionAgent, s: string){
    const encoder = new TextEncoder()
    const uint8 = encoder.encode(s)
    const res = await agent.bsky.uploadBlob(uint8)
    return res.data.blob
}


export async function uploadImageSrcBlob(agent: SessionAgent, src: string){
    const response = await fetch(src)
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const res = await agent.bsky.uploadBlob(uint8)
    return res.data.blob
}


export async function uploadImageBlob(agent: SessionAgent, image: ImagePayload){
    if(image.$type == "url") {
        return await uploadStringBlob(agent, image.src)
    } else {
        return await uploadImageSrcBlob(agent, image.image)
    }
}

