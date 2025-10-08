import {ArticleEmbed} from "#/lex-api/types/ar/cabildoabierto/feed/article.js"
import {ATProtoStrongRef} from "#/lib/types.js";


export type SyncContentProps = {
    format?: string
    text?: string
    textBlob?: {
        cid: string
        authorId: string
    }
    selfLabels?: string[]
    datasetsUsed?: string[]
    embeds: ArticleEmbed[]
}


export type RefAndRecord<T = any> = { ref: ATProtoStrongRef, record: T }