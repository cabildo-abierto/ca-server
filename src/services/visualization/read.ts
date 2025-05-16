import {AppContext} from "#/index";
import {enDiscusionQuery, reactionsQuery, recordQuery, visualizationQuery} from "#/utils/utils";
import {SessionAgent} from "#/utils/session-agent";


/*export async function getVisualizations(ctx: AppContext, agent: SessionAgent){
    let v = await ctx.db.record.findMany({
        select: {
            ...enDiscusionQuery,
            visualization: visualizationQuery
        },
        where: {
            collection: "ar.com.cabildoabierto.visualization",
            visualization: {
                isNot: null
            }
        },
        orderBy: {
            createdAt: "desc"
        }
    })

    const did = agent.did
    // const engagement = await getUserEngagement(ctx, v.map(x => x.uri), did)

    // TO DO: return addViewerToFeed(v, engagement)
}


export async function getVisualization(ctx: AppContext, agent: SessionAgent, uri: string): Promise<{visualization?: VisualizationProps, error?: string}> {

    try {
        const getVisualization = await ctx.db.record.findUnique({
            select: {
                ...recordQuery,
                ...reactionsQuery,
                visualization: visualizationQuery,
            },
            where: {
                uri: uri
            }
        })

        const did = agent.did
        const [visualization, engagement] = await Promise.all([getVisualization, engagement(ctx, [uri], did)])

        return {visualization: visualization as VisualizationProps} // TO DO: addViewer(visualization, engagement)}
    } catch (error) {
        console.error("Error getting visualization", uri)
        console.error(error)
        return {error: "Ocurrió un error al obtener la visualización."}
    }
}*/