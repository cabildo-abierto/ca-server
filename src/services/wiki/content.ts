import {AppContext} from "#/setup.js";
import {TextAndFormat} from "#/services/wiki/references/references.js";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms.js";
import {decompress} from "#/utils/compression.js";
import {getAllText} from "#/services/wiki/diff.js";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article.js"
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js"
import {BlobRef} from "#/services/hydration/hydrate.js";
import {getCollectionFromUri, getDidFromUri, isPost} from "#/utils/uri.js";
import {fetchTextBlobs} from "#/services/blob.js";


export function getNumWords(text: string, format: string) {
    if(format == "markdown" || format == "plain-text") {
        return text.split(" ").length
    } else if(format == "markdown-compressed"){
        return decompress(text).split(" ").length
    } else if(!format || format == "lexical-compressed") {
        return getAllText(JSON.parse(decompress(text)).root).split(" ").length
    } else if(format == "lexical"){
        return getAllText(JSON.parse(text).root).split(" ").length
    } else {
        throw Error("No se pudo obtener la cantidad de palabras de un contenido con formato: " + format)
    }
}


export async function updateContentsText(ctx: AppContext, uris?: string[]) {
    if(uris && uris.length == 0) return
    const batchSize = 50
    let offset = 0
    while(true){
        const contents = await ctx.kysely
            .selectFrom("Content")
            .innerJoin("Record", "Record.uri", "Content.uri")
            .select(["Content.uri", "textBlobId", "Record.record", "Content.format", "Content.text"])
            .where("Record.collection", "in", longTextCollections)
            .where("text", "is", null)
            .orderBy("Record.created_at", "desc")
            .$if(uris == null, qb => qb.limit(batchSize).offset(offset))
            .$if(uris != null, qb => qb.where("Record.uri", "in", uris!.slice(offset, offset+batchSize)))
            .execute()
        offset += batchSize

        if(contents.length == 0) break

        console.log(`updating ${contents.length} contents text in batch ${offset}`)
        const texts = await getContentsText(ctx, contents, undefined, false)

        await setContentsText(ctx, contents.map(c => c.uri), texts)

        if(contents.length < batchSize){
            break
        }
    }
}


async function setContentsText(ctx: AppContext, uris: string[], texts: (TextAndFormat | null)[]){
    const values: {
        uri: string
        selfLabels: string[]
        embeds: any[]
        dbFormat: string
        text: string
    }[] = texts.map((t, idx) => {
        if(!t) {
            t = {
                text: "",
                format: "plain-text"
            }
        }
        try {
            const res = anyEditorStateToMarkdownOrLexical(
                t.text,
                t.format
            )
            return {
                uri: uris[idx],
                selfLabels: [],
                embeds: [],
                dbFormat: res.format,
                text: res.text
            }
        } catch (err) {
            console.log("failed to process", uris[idx])
            console.log(t.text.length, t.text.slice(0, 100))
            console.log("Error", err)
            return null
        }
    }).filter(x => x != null)

    if(values.length > 0){
        await ctx.kysely
            .insertInto("Content")
            .values(values)
            .onConflict((oc) => oc.column("uri").doUpdateSet({
                text: eb => eb.ref("excluded.text"),
                dbFormat: eb => eb.ref("excluded.dbFormat")
            }))
            .execute()
    }
}


export async function updateContentsNumWords(ctx: AppContext) {
    const batchSize = 500
    let offset = 0
    while(true){
        console.log("updating num words for batch", offset)
        const contents = await ctx.kysely
            .selectFrom("Content")
            .innerJoin("Record", "Record.uri", "Content.uri")
            .select(["Content.uri", "Content.text", "Content.dbFormat"])
            .where("collection", "in", ["ar.cabildoabierto.wiki.topicVersion", "ar.cabildoabierto.feed.article"])
            .where("numWords", "is", null)
            .where("text", "is not", null)
            .limit(batchSize)
            .offset(offset)
            .execute()
        offset += contents.length

        const values = contents.map(c => {
            if(c.text != null){
                return {
                    uri: c.uri,
                    numWords: getNumWords(c.text, c.dbFormat ?? "lexical-compressed")
                }
            } else {
                return null
            }
        }).filter(x => x != null)

        if(values.length > 0){
            await ctx.kysely
                .insertInto("Content")
                .values(values.map(v => ({
                    uri: v.uri,
                    numWords: v.numWords,
                    selfLabels: [],
                    embeds: []
                })))
                .onConflict((oc) => oc.column("uri").doUpdateSet({
                    numWords: eb => eb.ref("excluded.numWords"),
                }))
                .execute()
        }

        if(values.length < batchSize){
            break
        }
    }
}


export const longTextCollections = ["ar.cabildoabierto.feed.article", "ar.cabildoabierto.wiki.topicVersion"]


export async function resetContentsFormat(ctx: AppContext) {
    const batchSize = 2000
    let offset = 0

    while(true){
        const contents = await ctx.kysely
            .selectFrom("Content")
            .innerJoin("Record", "Record.uri", "Content.uri")
            .select(["Record.record", "Record.uri"])
            .where("Record.collection", "in", longTextCollections)
            .limit(batchSize)
            .offset(offset)
            .execute()
        offset += contents.length

        const values = contents.map(c => {
            const recordStr = c.record
            const record = recordStr ? JSON.parse(recordStr) as ArticleRecord | TopicVersionRecord : null
            if(!record) {
                console.log("Warning: " + c.uri + " no tiene el registro.")
                return null
            }
            return {
                uri: c.uri,
                format: record.format,
                dbFormat: null,
                text: null,
                embeds: [],
                selfLabels: []
            }
        }).filter(x => x != null)

        if(values.length > 0){
            await ctx.kysely
                .insertInto("Content")
                .values(values)
                .onConflict((oc) => oc.column("uri").doUpdateSet({
                    format: eb => eb.ref("excluded.format"),
                    text: eb => eb.ref("excluded.text")
                }))
                .execute()
        }

        if(contents.length < batchSize) break
    }

}

export type ContentProps = {
    uri: string
    CAIndexedAt: Date
    text: string | null
    textBlobId?: string | null
    format: string | null
    dbFormat: string | null
    title: string | null
}


type MaybeContent = {
    text?: string | null
    textBlobId?: string | null
    format?: string | null
    dbFormat?: string | null
    uri: string
}


function isCompressed(format: string | null) {
    if (!format) return true
    return ["lexical-compressed", "markdown-compressed"].includes(format)
}


function formatToDecompressed(format: string) {
    return format.replace("compressed", "").replace("-", "")
}


export async function getContentsText(ctx: AppContext, contents: MaybeContent[], retries: number = 10, decompressed: boolean = true): Promise<(TextAndFormat | null)[]> {
    const texts: (TextAndFormat | null)[] = contents.map(_ => null)

    const blobRefs: { i: number, blob: BlobRef }[] = []
    for (let i = 0; i < contents.length; i++) {
        const c = contents[i]
        if (c.text != null) {
            texts[i] = {text: c.text, format: c.dbFormat ?? null}
        } else if (c.textBlobId) {
            blobRefs.push({i, blob: {cid: c.textBlobId, authorId: getDidFromUri(c.uri)}})
        }
    }

    const blobTexts = await fetchTextBlobs(ctx, blobRefs.map(x => x.blob), retries)

    for (let i = 0; i < blobRefs.length; i++) {
        const text = blobTexts[i]
        const format = contents[blobRefs[i].i].format
        texts[blobRefs[i].i] = text != null ? {
            text,
            format: format ?? null
        } : null
    }

    if (decompressed) {
        for (let i = 0; i < texts.length; i++) {
            const text = texts[i]
            if (text != null && text.text.length > 0 && !isPost(getCollectionFromUri(contents[i].uri)) && isCompressed(text.format ?? null)) {
                try {
                    texts[i] = {
                        text: decompress(text.text),
                        format: formatToDecompressed(text.format ?? "lexical-compressed")
                    }
                } catch {
                    ctx.logger.pino.error({uri: contents[i].uri}, `error decompressing text`)
                    texts[i] = null
                }
            }
        }
    }

    return texts
}