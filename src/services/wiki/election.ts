import { ArCabildoabiertoEmbedVisualization } from "#/lex-api/index.js";
import {AppContext} from "#/setup.js";
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js";
import {CAHandler} from "#/utils/handler.js";
import {getDataset} from "#/services/dataset/read.js";
import {isDatasetDataSource, isEleccion} from "#/lex-api/types/ar/cabildoabierto/embed/visualization.js";

export type TopicData = {
    id: string
    props: TopicProp[]
    repliesCount: number
}


export const getTopicsDataForElectionVisualization = async (ctx: AppContext, v: ArCabildoabiertoEmbedVisualization.Main): Promise<TopicData[]> => {
    ctx.logger.pino.info({
        v
    }, "getting election visualization")

    if(!isDatasetDataSource(v.dataSource)) return []
    if(!isEleccion(v.spec)){
        return []
    }

    const datasetUri = v.dataSource.dataset

    const {data} = await getDataset(
        ctx,
        datasetUri
    )

    if(!data) return []

    const dataset: Record<string, any>[] = JSON.parse(data.data)

    const topicIds = new Set<string>()

    const candidateCol = v.spec.columnaTopicIdCandidato
    const alianzaCol = v.spec.columnaTopicIdAlianza
    const districtCol = v.spec.columnaTopicIdDistrito

    for(let i = 0; i < dataset.length; i++) {
        if(candidateCol) topicIds.add(dataset[i][candidateCol])
        if(alianzaCol) topicIds.add(dataset[i][alianzaCol])
        if(districtCol) topicIds.add(dataset[i][districtCol])
    }

    const topicsData = await ctx.kysely
        .selectFrom("Topic")
        .innerJoin("TopicVersion", "Topic.currentVersionId", "TopicVersion.uri")
        .select([
            "Topic.id as id",
            "TopicVersion.props",
            eb => eb
                .selectFrom("Post")
                .innerJoin("TopicVersion as OtherTopicVersion", "Post.replyToId", "OtherTopicVersion.uri")
                .whereRef("OtherTopicVersion.topicId", "=", "Topic.id")
                .select(eb => eb.fn.count<number>("Post.uri").as("count"))
            .as("repliesCount")
        ])
        .where("TopicVersion.topicId", "in", Array.from(topicIds))
        .execute()

    return topicsData.map(t => ({
        id: t.id,
        props: t.props as TopicProp[],
        repliesCount: t.repliesCount ?? 0,
    }))
}


export const getTopicsDataForElectionVisualizationHandler: CAHandler<{v: ArCabildoabiertoEmbedVisualization.Main}, TopicData[]> = async (ctx, agent, params) => {
    return {
        data: await getTopicsDataForElectionVisualization(ctx, params.v)
    }
}