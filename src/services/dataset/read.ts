import {decompress} from "#/utils/compression";
import {DatasetView, DatasetViewBasic} from "#/lex-api/types/ar/cabildoabierto/data/dataset";
import {CAHandler} from "#/utils/handler";
import {dbUserToProfileViewBasic} from "#/services/wiki/topics";
import {getUri} from "#/utils/uri";
import {AppContext} from "#/index";
import {Dataplane} from "#/services/hydration/dataplane";
import {listOrderDesc, sortByKey} from "#/utils/arrays";


export const getDataset: CAHandler<{
    params: { did: string, collection: string, rkey: string }
}, DatasetView> = async (ctx, agent, {params}) => {
    const {did, collection, rkey} = params
    const uri = getUri(did, collection, rkey)

    const dataplane = new Dataplane(ctx, agent)
    await dataplane.fetchDatasetsHydrationData([uri])
    await dataplane.fetchDatasetContents([uri])

    const view = hydrateDatasetView(uri, dataplane)
    if(!view) return {error: "Ocurrió un error al obtener el dataset."}
    return {data: view}
}


export async function getDatasetList(ctx: AppContext) {
    return (await ctx.db.record.findMany({
        select: {
            uri: true
        },
        where: {
            collection: {
                in: ["ar.com.cabildoabierto.dataset", "ar.cabildoabierto.data.dataset"]
            }
        }
    })).map(d => d.uri)
}


export const hydrateDatasetView = (uri: string, data: Dataplane): DatasetView | null => {
    const d = data.datasets.get(uri)
    if(!d || !d.dataset) return null

    const basicView = hydrateDatasetViewBasic(uri, data)
    if(!basicView) return null

    const content = data.datasetContents.get(uri)

    let rows: any[] = []

    if(content && content.length === d.dataset.dataBlocks.length) {
        for(let i = 0; i < content.length; i++) {
            if(d.dataset.dataBlocks[i].format == "json-compressed"){
                const json: any[] = JSON.parse(decompress(content[i]))
                rows = [...rows, ...json]
            } else {
                console.warn("Formato de dataset no soportado:", d.dataset.dataBlocks[i].format)
            }
        }
    } else if(content){
        console.log(content.length, "!=", d.dataset.dataBlocks.length)
    }

    return {
        ...basicView,
        $type: "ar.cabildoabierto.data.dataset#datasetView",
        data: JSON.stringify(rows)
    }
}


export const hydrateDatasetViewBasic = (uri: string, data: Dataplane): DatasetViewBasic | null => {
    const d = data.datasets?.get(uri)
    if(!d) return null

    const author = dbUserToProfileViewBasic(d.author)

    if (d.dataset && d.cid && author) {
        return {
            $type: "ar.cabildoabierto.data.dataset#datasetViewBasic",
            name: d.dataset.title,
            uri: d.uri,
            cid: d.cid,
            author,
            createdAt: new Date(d.createdAt).toISOString(),
            columns: d.dataset.columns.map(c => ({
                $type: "ar.cabildoabierto.data.dataset#column",
                name: c
            }))
        }
    }
    return null
}


export const getDatasets: CAHandler<{}, DatasetViewBasic[]> = async (ctx, agent, {}) => {
    const data = new Dataplane(ctx, agent)

    const datasetList: string[] = await getDatasetList(ctx)

    await data.fetchDatasetsHydrationData(datasetList)

    const views: DatasetViewBasic[] = datasetList
        .map(d => hydrateDatasetViewBasic(d, data))
        .filter(v => v != null)

    return {data: sortByKey(views, x => [new Date(x.createdAt).getTime()], listOrderDesc)}
}