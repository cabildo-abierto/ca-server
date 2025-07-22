import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import got from 'got';
import * as cheerio from 'cheerio';
import {getUri, isArticle, isDataset, isPost} from "#/utils/uri";

const getContent = async (url: string): Promise<Partial<Metadata>> => {
    const {body: html} = await got(url);
    const $ = cheerio.load(html);

    return {
        title: $('meta[property="og:title"]').attr('content') || $('title').text(),
        description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'),
        thumbnail: $('meta[property="og:image"]').attr('content'),
    };
}

type Metadata = {
    title: string
    description: string
    thumbnail: string
}


export const fetchURLMetadata: CAHandler<{
    query: { url: string }
}, Partial<Metadata>> = async (ctx, agent, {query}) => {
    const {url} = query

    if (!url) return {error: "Falta el URL."}

    try {

        const metadata = await getContent(url)

        return {
            data: {
                title: metadata.title ?? undefined,
                description: metadata.description ?? undefined,
                thumbnail: metadata.thumbnail ?? undefined,
            }
        }
    } catch (err) {
        console.error('Metadata scrape failed:', err);
        return {error: "Error al obtener los metadatos."}
    }
}


function getUsername(user: { displayName: string | null, handle: string | null }) {
    return user.displayName ? user.displayName : user.handle ? "@" + user.handle : null
}


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
            .select(["title", "User.displayName", "User.handle"])
            .where("Record.uri", "=", uri)
            .execute()
        if (article.length > 0) {
            return {
                data: {
                    title: article[0].title,
                    description: `Artículo de ${getUsername(article[0])} en Cabildo Abierto.`,
                    thumbnail: "https://cabildoabierto.ar/logo.png"
                }
            }
        }
    } else if (isPost(c)) {
        const post = await ctx.kysely
            .selectFrom("Content")
            .innerJoin("Record", "Record.uri", "Content.uri")
            .innerJoin("User", "Record.authorId", "User.did")
            .select(["text", "User.displayName", "User.handle"])
            .where("Record.uri", "=", uri)
            .execute()

        if (post.length > 0) {
            return {
                data: {
                    title: `${getUsername(post[0])}: "${post[0].text}"`,
                    description: post[0].text as string,
                    thumbnail: "https://cabildoabierto.ar/logo.png"
                }
            }
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
                    description: dataset[0].description ?? "Mirá este conjunto de datos en Cabildo Abierto.",
                    thumbnail: "https://cabildoabierto.ar/logo.png"
                }
            }
        }
    }

    return {error: "No se encontró el contenido."}
}