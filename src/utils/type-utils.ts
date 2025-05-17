import {FullArticleView, PostView} from "#/lex-api/types/ar/cabildoabierto/feed/defs"
import {$Typed} from "@atproto/api";
import {ArticleView} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {ReactionRecord, ReactionType} from "#/services/reactions/reactions";


export function isKnownContent(content: any): content is $Typed<ArticleView> | $Typed<PostView> | $Typed<FullArticleView> {
    return content?.$type === 'ar.cabildoabierto.feed.defs#postView' ||
        content?.$type === 'ar.cabildoabierto.feed.defs#articleView' ||
        content?.$type === 'ar.cabildoabierto.feed.defs#fullArticleView';
}


export function isReaction(content: any): content is ReactionRecord {
    return isReactionCollection(content?.$type)
}


export function isReactionCollection(c: string): c is ReactionType {
    return [
        "app.bsky.feed.like",
        "app.bsky.feed.repost",
        "ar.cabildoabierto.wiki.voteAccept",
        "ar.cabildoabierto.wiki.voteReject"
    ].includes(c)
}
