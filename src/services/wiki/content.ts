import {AppContext} from "#/index";
import {getContentsText} from "#/services/wiki/references";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms";
import {decompress} from "#/utils/compression";
import {getAllText} from "#/services/wiki/diff";
import {Record as ArticleRecord} from "#/lex-api/types/ar/cabildoabierto/feed/article"
import {Record as TopicVersionRecord} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"


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


export async function updateContentsText(ctx: AppContext) {
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
            .limit(batchSize)
            .offset(offset)
            .execute()
        offset += batchSize

        console.log(`updating ${contents.length} contents text in batch ${offset}`)
        const texts = await getContentsText(ctx, contents, undefined, false)
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
                    uri: contents[idx].uri,
                    selfLabels: [],
                    embeds: [],
                    dbFormat: res.format,
                    text: res.text
                }
            } catch (err) {
                console.log("failed to process", contents[idx].uri)
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

        if(contents.length < batchSize){
            break
        }
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