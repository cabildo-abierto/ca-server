import {handleToDid} from "#/services/user/users";
import {getMainProfileFeedSkeleton} from "#/services/feed/profile/main";
import {getRepliesProfileFeedSkeleton} from "#/services/feed/profile/replies";
import {FeedPipelineProps, getFeed, GetFeedOutput} from "#/services/feed/feed";
import {creationDateSortKey, rootCreationDateSortKey} from "#/services/feed/utils";
import {getEditsProfileFeedSkeleton} from "#/services/feed/profile/edits";
import {CAHandler} from "#/utils/handler";
import {filterFeed} from "#/services/feed/inicio/following";
import {getArticlesProfileFeedSkeleton} from "#/services/feed/profile/articles";


export const getProfileFeed: CAHandler<{params: {handleOrDid: string, kind: string}, query: {cursor?: string}}, GetFeedOutput> = async (ctx, agent, {params, query}) => {
    const {handleOrDid, kind} = params
    const {cursor} = query
    const did = await handleToDid(ctx, agent, handleOrDid)
    if(!did) return {error: "No se encontró el usuario."}

    let pipeline: FeedPipelineProps
    if(kind == "publicaciones"){
        pipeline = {
            getSkeleton: getMainProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey,
            filter: (ctx, f) => filterFeed(ctx, f, true)
        }
    } else if(kind == "respuestas"){
        pipeline = {
            getSkeleton: getRepliesProfileFeedSkeleton(did),
            sortKey: creationDateSortKey,
            filter: (ctx, f) => filterFeed(ctx, f, true)
        }
    } else if(kind == "ediciones") {
        pipeline = {
            getSkeleton: getEditsProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey
        }
    } else if(kind == "articulos") {
        pipeline = {
            getSkeleton: getArticlesProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey
        }
    } else {
        return {error: "Feed inválido."}
    }

    return await getFeed({ctx, agent, pipeline, cursor})
}