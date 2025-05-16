import {BlobRef} from "@atproto/lexicon";
import {ATProtoStrongRef} from "#/lib/types";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {processCreate} from "#/services/sync/process-event";

type VisualizationSpec = {
    // TO DO
}

type VisualizationSpecWithMetadata = {
    // TO DO
}

export async function createVisualizationATProto(agent: SessionAgent, spec: VisualizationSpec, preview: FormData): Promise<{error?: string, ref?: ATProtoStrongRef, record?: any}> {

    try {

        const data = Object.fromEntries(preview);
        const f = data.data as File

        const headers: Record<string, string> = {
            "Content-Length": f.size.toString()
        }

        let blob: BlobRef
        try {
            const res = await agent.bsky.uploadBlob(f, {headers})
            blob = res.data.blob
        } catch {
            console.error("Error uploading preview")
            return {error: "Ocurrió un error al guardar la visualización."}
        }

        const record = {
            spec: JSON.stringify(spec),
            createdAt: new Date().toISOString(),
            preview: {
                ref: blob.ref,
                mimeType: blob.mimeType,
                size: blob.size,
                $type: "blob"
            },
        }

        const {data: ref} = await agent.bsky.com.atproto.repo.createRecord({
            repo: agent.did,
            collection: "ar.com.cabildoabierto.visualization",
            record: record,
        })
        return {ref, record}
    } catch (err) {
        console.error("error", err)
        return {error: "Ocurrió un error al guardar la visualización."}
    }
}


export async function createVisualization(ctx: AppContext, agent: SessionAgent, spec: VisualizationSpecWithMetadata, preview: FormData){
    const {error, record, ref} = await createVisualizationATProto(agent, spec, preview)
    if(error){
        return {error}
    }
    if(!ref) return {error: "Ocurrió un error al crear la visualización"}
    const su = await processCreate(ctx, ref, record)
    await su.apply()

    return {}
}