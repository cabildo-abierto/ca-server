import {handleToDid} from "#/services/user/users";
import {getMainProfileFeedSkeleton} from "#/services/feed/profile/main";
import {getRepliesProfileFeedSkeleton} from "#/services/feed/profile/replies";
import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {FeedPipelineProps, getFeed} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";
import {getEditsProfileFeedSkeleton} from "#/services/feed/profile/edits";
import {CAHandler} from "#/utils/handler";
import {filterFeed} from "#/services/feed/inicio/following";


export const getProfileFeed: CAHandler<{params: {handleOrDid: string, kind: string}}, FeedViewContent[]> = async (ctx, agent, {params}) => {
    const {handleOrDid, kind} = params
    const did = await handleToDid(ctx, agent, handleOrDid)
    if(!did) return {error: "No se encontró el usuario."}

    let pipeline: FeedPipelineProps
    if(kind == "publicaciones"){
        pipeline = {
            getSkeleton: getMainProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey,
            filter: filterFeed
        }
    } else if(kind == "respuestas"){
        pipeline = {
            getSkeleton: getRepliesProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey, // TO DO: Reemplazar por fecha de la última respuesta
            filter: filterFeed
        }
    } else if(kind == "ediciones"){
        pipeline = {
            getSkeleton: getEditsProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey
        }
    } else {
        return {error: "Feed inválido."}
    }

    return getFeed({ctx, agent, pipeline})
}