import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {ThreadViewContent} from "#/lex-server/types/ar/cabildoabierto/feed/defs";
import {isKnownContent} from "#/utils/type-utils";


function getRootCreationDate(p: FeedViewContent): Date | null {
    if(p.reason && "indexedAt" in p.reason){
        return new Date(p.reason.indexedAt)
    } else if(p.content.$type == "app.bsky.feed.defs#postView"){
        if(p.reply && p.reply.root && "indexedAt" in p.reply.root){
            return new Date(p.reply.root.indexedAt)
        } else if(p.reply && p.reply.parent && "indexedAt" in p.reply.parent){
            return new Date(p.reply.parent.indexedAt)
        }
    }
    if("indexedAt" in p.content){
        return new Date(p.content.indexedAt)
    }
    return null
}


export const creationDateSortKey = (a: ThreadViewContent) => {
    return isKnownContent(a.content) ? [new Date(a.content.indexedAt).getTime()] : [0]
}


export const rootCreationDateSortKey = (a: FeedViewContent) => {
    const date = getRootCreationDate(a)
    return date ? [date.getTime()] : [0]
}
