import {decompress} from "#/utils/compression";
import {Column, DatasetView, DatasetViewBasic, TopicsDatasetView} from "#/lex-api/types/ar/cabildoabierto/data/dataset";
import {CAHandler} from "#/utils/handler";
import {dbUserToProfileViewBasic} from "#/services/wiki/topics";
import {getUri} from "#/utils/uri";
import {AppContext} from "#/index";
import {Dataplane} from "#/services/hydration/dataplane";
import {listOrderDesc, sortByKey} from "#/utils/arrays";
import {
    ColumnFilter,
    isColumnFilter,
    Main as Visualization
} from "#/lex-api/types/ar/cabildoabierto/embed/visualization"
import {sql} from "kysely";
import {TopicProp, validateTopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {$Typed} from "@atproto/api";


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

type TopicDatasetSpec = {
    filters: Visualization["filters"]
}

export function stringListIsEmpty(name: string) {
    const type = `ar.cabildoabierto.wiki.topicVersion#stringListProp`
    const wrongTypePath = `$[*] ? (@.name == "${name}" && @.value."$type" != "${type}")`
    const emptyPath = `$[*] ? (@.name == "${name}" && @.value."$type" == "${type}" && @.value.value.size() == 0)`
    const existsPath = `$[*] ? (@.name == "${name}")`

    return sql<boolean>`
        "TopicVersion"."props" IS NULL
        OR (
            NOT jsonb_path_exists("TopicVersion"."props", ${existsPath}::jsonpath)
        OR jsonb_path_exists("TopicVersion"."props", ${wrongTypePath}::jsonpath)
        OR jsonb_path_exists("TopicVersion"."props", ${emptyPath}::jsonpath)
        )
    `;
}

export function stringListIncludes(name: string, value: string) {
    const type = `ar.cabildoabierto.wiki.topicVersion#stringListProp`
    const path = `$[*] ? (@.name == "${name}" && @.value."$type" == "${type}" && exists(@.value.value[*] ? (@ == "${value}")))`;
    return sql<boolean>`
        jsonb_path_exists("TopicVersion"."props", ${path}::jsonpath)
    `;
}

export async function getFilteredTopics(ctx: AppContext, filters: $Typed<ColumnFilter>[], includeProps: boolean = true, limit?: number){
    const includesFilters: {name: string, value: string}[] = []
    filters.forEach(f => {
        if(f.operator == "includes" && f.operands && f.operands.length > 0) {
            includesFilters.push({name: f.column, value: f.operands[0]})
        }
    })

    const query = ctx.kysely
        .selectFrom('Topic')
        .innerJoin('TopicVersion', 'TopicVersion.uri', 'Topic.currentVersionId')
        .select(includeProps ? ['id', 'TopicVersion.props'] : ['id'])
        .where((eb) =>
            eb.and(includesFilters.map(f => stringListIncludes(f.name, f.value)))
        )

    return await (limit ? query.limit(limit) : query).execute()
}


export const getTopicsDatasetHandler: CAHandler<TopicDatasetSpec, TopicsDatasetView> = async (ctx, agent, params) => {
    const filters = params.filters ? params.filters.filter(f => isColumnFilter(f)): []
    if(filters.length == 0) return {error: "Aplicá al menos un filtro."}

    const topics = await getFilteredTopics(ctx, filters)

    let data: string = ""
    let columns: Column[] = []
    if(topics.length == 0){
        data = JSON.stringify([])
    } else {
        const props = topics[0].props as TopicProp[]
        columns = [{name: "Tema"}, ...props.map(p => ({
            name: p.name
        }))]
        const rows = topics.map(t => {
            const props = t.props as TopicProp[]

            const row: Record<string, any> = {
                "Tema": t.id
            }
            props.forEach(p => {
                const valid = validateTopicProp(p)
                if(valid.success && "value" in valid.value.value){
                    row[p.name] = valid.value.value.value
                }
            })

            return row
        })
        data = JSON.stringify(rows)
    }

    const dataset: TopicsDatasetView = {
        $type: "ar.cabildoabierto.data.dataset#topicsDatasetView",
        data,
        columns
    }

    return {data: dataset}
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
            description: d.dataset.description ?? undefined,
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