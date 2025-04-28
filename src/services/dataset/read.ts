import JSZip from "jszip";
import Papa from 'papaparse';
import {fetchBlob} from "../blob";
import {compress, decompress} from "#/utils/compression";
import {AppContext} from "#/index";
import {datasetQuery, recordQuery} from "#/utils/utils";
import {gett} from "#/utils/arrays";
import {DatasetView} from "#/lex-api/types/ar/cabildoabierto/data/dataset";


function compressData(data: any[]){
    const s = JSON.stringify(data)
    return compress(s)
}


function decompressDataset(dataset: {dataset: DatasetView, data: string}){
    const decompressedData = decompress(dataset.data)
    const res = JSON.parse(decompressedData)

    return {dataset: dataset.dataset, data: res}
}


/*export async function getDataset(ctx: AppContext, uri: string): Promise<{dataset?: {dataset: DatasetView, data: any[]}, error?: string}> {
    const did = getDidFromUri(uri)
    const rkey = getRkeyFromUri(uri)
    const compressedDataset = await getCompressedDataset(ctx, uri)
    if(!compressedDataset.dataset) return {error: compressedDataset.error}

    const dataset = decompressDataset(compressedDataset)

    if(dataset.dataset.dataset.columnValues && "length" in dataset.dataset.dataset.columnValues){
        const m = new Map<string, any[]>()
        dataset.dataset.dataset.columnValues.forEach(({column, values}) => {
            m.set(column, values)
        })

        return {
            ...dataset,
            dataset: {
                ...dataset.dataset,
                dataset: {
                    ...dataset.dataset.dataset,
                    columnValues: m
                }
            }
        }
    } else {
        return dataset
    }
}*/


export async function getCompressedDataset(ctx: AppContext, uri: string): Promise<{dataset?: {dataset: DatasetView, data: string}, error?: string}> {

    const dataset = await ctx.db.record.findUnique({
        select: {
            ...recordQuery,
            dataset: datasetQuery,
            visualizationsUsing: {
                select: {
                    uri: true
                }
            }
        },
        where: {
            uri: uri
        }
    })

    if(!dataset || !dataset.dataset) {return {error: "No se pudo obtener el dataset."}}

    let acumSize = 0
    let data: any[] = []
    const blocks = dataset.dataset.dataBlocks
    for(let i = 0; i < blocks.length; i++){
        const blob = blocks[i].blob
        if(!blob) return {error: "No se pudo obtener el dataset."}

        const uint8Array = await fetchBlob(blob)
        if(!uint8Array || !uint8Array.ok){
            return {error: "Ocurrió un error al obtener los datos del dataset."}
        }

        let strContent = undefined
        if(blocks[i].format == "zip"){
            const zip = new JSZip();

            const buffer = await uint8Array.arrayBuffer()

            acumSize += buffer.byteLength

            if(acumSize > 1000000){
                return {error: "No podemos mostrar el conjunto de datos porque pesa más de 1mb."}
            }

            const unzipped = await zip.loadAsync(buffer)

            const fileNames = Object.keys(unzipped.files);
            if (fileNames.length === 0) {
                throw new Error('No files found in the zip.');
            }

            strContent = await unzipped.file(fileNames[0])!.async('string')
        } else {
            strContent = await uint8Array.text()
        }

        const parsedData = Papa.parse(strContent, {
            header: true,
            skipEmptyLines: true,
        })

        data = [...data, ...parsedData.data];
    }

    const columnValues = new Map<string, Set<any>>()
    for(let i = 0; i < dataset.dataset.columns.length; i++){
        columnValues.set(dataset.dataset.columns[i], new Set())
    }
    for(let i = 0; i < data.length; i++){
        for(let j = 0; j < dataset.dataset.columns.length; j++){
            const c = dataset.dataset.columns[j]
            gett(columnValues, c).add(data[i][c])
        }
    }

    function setValuesToListValues(s: Map<string, Set<any>>){
        const r: {column: string, values: any[]}[] = []
        s.forEach((v, k) => {
            r.push({column: k, values: Array.from(v).sort()})
        })
        return r
    }

    const datasetWithColumnValues: DatasetView = {
        ...dataset,
        dataset: {
            ...dataset.dataset,
            columnValues: setValuesToListValues(columnValues)
        }
    } as unknown as DatasetView // TO DO

    return {dataset: {dataset: datasetWithColumnValues, data: compressData(data)}}
}


/*export async function getDatasets(): Promise<FeedContentProps[]>{
    const did = await getSessionDidNoRevalidate()

    let datasets: DatasetView[] = await unstable_cache(
        async () => {
            return await db.record.findMany({
                select: {
                    ...enDiscusionQuery,
                    dataset: datasetQuery,
                    visualizationsUsing: {
                        select: {
                            uri: true
                        }
                    }
                },
                where: {
                    collection: "ar.com.cabildoabierto.dataset"
                }
            })
        },
        undefined,
        {
            tags: ["datasets"],
            revalidate: revalidateEverythingTime
        }
    )()

    const engagement = await getUserEngagement(datasets, did)

    datasets = datasets.filter((d) => {
        return d.dataset.dataBlocks.length > 0
    })

    return addCountersToFeed(datasets, engagement)
}*/