import { CAHandler, CAHandlerNoAuth } from "#/utils/handler.js";
import * as cheerio from "cheerio";
import { getUri, isArticle, isDataset, isPost } from "#/utils/uri.js";

const getContent = async (url: string): Promise<Partial<Metadata>> => {
    const response = await fetch(url)
    const html = await response.text()
    const $ = cheerio.load(html)

    return {
        title:
            $('meta[property="og:title"]').attr("content") || $("title").text(),
        description:
            $('meta[property="og:description"]').attr("content") ||
            $('meta[name="description"]').attr("content"),
        thumbnail: $('meta[property="og:image"]').attr("content"),
    }
}

type Metadata = {
    title: string
    description: string
    thumbnail: string
}


export const fetchURLMetadataHandler: CAHandler<{ url: string }, Partial<Metadata>> = async (
    ctx,
    agent,
    {url}
) => {
    if (!url) return {error: "Falta el URL."}

    try {
        const metadata = await getContent(url)

        // ctx.logger.pino.info({metadata, url}, "got metadata")

        return {
            data: {
                title: metadata.title ?? undefined,
                description: metadata.description ?? undefined,
                thumbnail: metadata.thumbnail ?? undefined,
            }
        }
    } catch (err) {
        ctx.logger.pino.error({error: err}, 'Metadata scrape failed:')
        return {error: "Error al obtener los metadatos."}
    }
}


const banner = "https://cabildoabierto.ar/banners/99.jpg"


export const getContentMetadata: CAHandlerNoAuth<{
    params: { did: string, collection: string, rkey: string }
}, Metadata> = async (ctx, agent, {params}) => {
    const c = params.collection
    const uri = getUri(params.did, c, params.rkey)
    if (isArticle(c)) {
        const article = await ctx.kysely
            .selectFrom("Article")
            .innerJoin("Record", "Record.uri", "Article.uri")
            .innerJoin("User", "Record.authorId", "User.did")
            .select(["title", "User.handle"])
            .where("Record.uri", "=", uri)
            .execute()

        const description = `Artículo de @${article[0].handle}.`

        if (article.length > 0) {
            return {
                data: {
                    title: article[0].title,
                    description: description,
                    thumbnail: banner
                }
            }
        }
    } else if (isPost(c)) {
        try {
            const post = await ctx.kysely
                .selectFrom("Content")
                .innerJoin("Record", "Record.uri", "Content.uri")
                .innerJoin("User", "Record.authorId", "User.did")
                .select(["text", "User.displayName", "User.handle"])
                .where("Record.uri", "=", uri)
                .executeTakeFirst()
            if (post) {
                const data = {
                    title: post.displayName ? `${post.displayName} (@${post.handle})` : `@${post.handle}`,
                    description: post.text as string,
                    thumbnail: banner
                }
                return {
                    data
                }
            } else {
                ctx.logger.pino.warn({uri}, "post metadata not found")
                return {error: "No se encontró la publicación."}
            }
        } catch (error) {
            ctx.logger.pino.error({error}, "error getting post metadata")
            return {error: "Ocurrió un error al obtener los metadatos."}
        }
    } else if (isDataset(c)) {
        const dataset = await ctx.kysely
            .selectFrom("Dataset")
            .innerJoin("Record", "Record.uri", "Dataset.uri")
            .innerJoin("User", "Record.authorId", "User.did")
            .select(["Dataset.title", "Dataset.description", "User.displayName", "User.handle"])
            .where("Record.uri", "=", uri)
            .execute()

        if (dataset.length > 0) {
            return {
                data: {
                    title: dataset[0].title,
                    description: dataset[0].description ?? "Conjunto de datos.",
                    thumbnail: banner
                }
            }
        }
    }

    return {error: "No se encontró el contenido."}
}