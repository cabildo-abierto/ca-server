import {CAHandler} from "#/utils/handler";
import got from 'got';
import * as cheerio from 'cheerio';

const getContent = async (url: string) => {
    const { body: html } = await got(url);
    const $ = cheerio.load(html);

    return {
        title: $('meta[property="og:title"]').attr('content') || $('title').text(),
        description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'),
        image: $('meta[property="og:image"]').attr('content'),
    };
};

export const fetchURLMetadata : CAHandler<{query: {url: string}}, {title?: string, description?: string, thumb?: string}> = async (ctx, agent, {query}) => {
    const { url } = query

    if (!url) return {error: "Falta el URL."}

    try {

        const metadata = await getContent(url)

        return {data: {
                title: metadata.title ?? undefined,
                description: metadata.description ?? undefined,
                thumb: metadata.image ?? undefined,
            }}
    } catch (err) {
        console.error('Metadata scrape failed:', err);
        return {error: "Error al obtener los metadatos."}
    }
}