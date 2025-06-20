import {CAHandler} from "#/utils/handler";
import {getServiceEndpointForDid} from "#/services/blob";
import {getUserRepo} from "#/services/sync/sync-user";

type UserRepoCounts = {
    counts: {
        collection: string
        count: number
    }[]
}

export const getRepoCounts: CAHandler<{params: {handleOrDid: string}}, UserRepoCounts> = async (ctx, agent, {params}) => {
    const {handleOrDid} = params
    const did = await ctx.resolver.resolveHandleToDid(handleOrDid)
    if(!did){
        return {error: "No se encontró el usuario"}
    }

    const doc = await getServiceEndpointForDid(did)
    if(!doc){
        return {error: "No se encontró el repositorio."}
    }

    let repo = await getUserRepo(did, doc)
    if(!repo){
        return {error: "No se pudo obtener el repositorio."}
    }

    const counts = new Map<string, number>()
    repo.forEach(r => {
        counts.set(r.collection, (counts.get(r.collection) ?? 0) + 1)
    })

    return {
        data: {
            counts: Array.from(counts.entries()).map(c => {
                return {
                    collection: c[0],
                    count: c[1]
                }
            })
        }
    }
}