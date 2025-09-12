import {SessionAgent} from "#/utils/session-agent";
import {CAHandler} from "#/utils/handler";
import {uploadStringBlob} from "#/services/blob";
import {Record as DatasetRecord} from "#/lex-api/types/ar/cabildoabierto/data/dataset";
import {BlobRef} from "@atproto/lexicon";
import {compress} from "#/utils/compression";
import {DatasetRecordProcessor} from "#/services/sync/event-processing/dataset";


export async function createDatasetATProto(agent: SessionAgent, params: CreateDatasetProps) {
    if(params.format != "json"){
        return {error: "Formato no soportado."}
    }
    let blobRef: BlobRef | null = null
    try {
        blobRef = await uploadStringBlob(agent, compress(params.data))
    } catch (err) {
        console.error("Error al publicar el blob.")
        console.error(err)
        return {error: "Error al publicar el dataset."}
    }

    const curDate = new Date().toISOString()

    const record: DatasetRecord = {
        name: params.name,
        createdAt: curDate,
        columns: params.columns.map((c) => ({name: c})),
        description: params.description,
        data: [
            {
                $type: "ar.cabildoabierto.data.dataset#dataBlock",
                blob: blobRef,
                format: "json-compressed"
            }
        ],
        $type: "ar.cabildoabierto.data.dataset"
    }

    try {
        const {data: datasetData} = await agent.bsky.com.atproto.repo.createRecord({
            repo: agent.did,
            collection: "ar.cabildoabierto.data.dataset",
            record: record
        })

        return {
            record,
            ref: {cid: datasetData.cid, uri: datasetData.uri}
        }
    } catch (e) {
        console.error(e)
        return {error: "No se pudo publicar el dataset."}
    }
}

export type CreateDatasetProps = {
    name: string
    description: string
    columns: string[]
    data: string
    format?: string
}

export const createDataset: CAHandler<CreateDatasetProps> = async (ctx, agent, params) => {
    const {error, record, ref} = await createDatasetATProto(agent, params)
    if (error || !record || !ref) return {error}

    await new DatasetRecordProcessor(ctx).processValidated([{ref, record}])

    return {}
}