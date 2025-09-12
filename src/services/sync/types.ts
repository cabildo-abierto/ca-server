import {ArticleEmbed} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {ATProtoStrongRef} from "#/lib/types";


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