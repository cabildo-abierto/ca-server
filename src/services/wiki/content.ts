import {AppContext} from "#/index";
import {getContentsText} from "#/services/wiki/references";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms";


export async function updateContentsText(ctx: AppContext) {
    const batchSize = 500
    let offset = 0
    while(true){
        const contents = await ctx.kysely
            .selectFrom("Content")
            .innerJoin("Record", "Record.uri", "Content.uri")
            .select(["Content.uri", "textBlobId", "format", "Record.record"])
            .where("Record.collection", "in", [
                "ar.cabildoabierto.wiki.topicVersion",
                "ar.cabildoabierto.feed.article"
            ])
            .where("text", "is", null)
            .limit(batchSize)
            .offset(offset)
            .execute()
        offset += batchSize

        console.log(`updating ${contents.length} contents text in batch ${offset}`)
        const texts = await getContentsText(ctx, contents.map(c => ({...c, text: null})), undefined, false)
        const values: {
            uri: string
            selfLabels: string[]
            embeds: any[]
            text: string
        }[] = texts.map((t, idx) => {
            if(!t) t = ""
            try {
                const content = contents[idx]
                const format = content.record ? JSON.parse(content.record).format : null
                if(!format) return null

                const res = anyEditorStateToMarkdownOrLexical(
                    t,
                    format
                )
                return {
                    uri: contents[idx].uri,
                    selfLabels: [],
                    embeds: [],
                    format: res.format,
                    text: res.text ?? ""
                }
            } catch {
                console.log("failed to process", contents[idx].uri)
                console.log(t.length, t.slice(0, 100), contents[idx].format)
                return null
            }
        }).filter(x => x != null)

        if(values.length > 0){
            await ctx.kysely
                .insertInto("Content")
                .values(values)
                .onConflict((oc) => oc.column("uri").doUpdateSet({
                    text: eb => eb.ref("excluded.text"),
                    format: eb => eb.ref("excluded.format")
                }))
                .execute()
        }
        if(contents.length < batchSize){
            break
        }
    }
}