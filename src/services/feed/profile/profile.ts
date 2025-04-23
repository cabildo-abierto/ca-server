import {AppContext} from "#/index";
import {SessionAgent} from "#/utils/session-agent";
import {handleToDid} from "#/services/user/users";
import {getMainProfileFeedSkeleton} from "#/services/feed/profile/main";
import {getRepliesProfileFeedSkeleton} from "#/services/feed/profile/replies";
import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {FeedPipelineProps, getFeed} from "#/services/feed/feed";
import {rootCreationDateSortKey} from "#/services/feed/utils";
import {getEditsProfileFeedSkeleton} from "#/services/feed/profile/edits";


export async function getProfileFeed(ctx: AppContext, agent: SessionAgent, handleOrDid: string, kind: string): Promise<{error?: string, feed?: FeedViewContent[]}>{

    const did = await handleToDid(agent, handleOrDid)

    let pipeline: FeedPipelineProps
    if(kind == "publicaciones"){
        pipeline = {
            getSkeleton: getMainProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey
        }
    } else if(kind == "respuestas"){
        pipeline = {
            getSkeleton: getRepliesProfileFeedSkeleton(did),
            sortKey: rootCreationDateSortKey // TO DO: Reemplazar por fecha de la última respuesta
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