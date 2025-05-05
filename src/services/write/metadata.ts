import {CAHandler} from "#/utils/handler";
const getHTML = require('html-get')
const browserless = require('browserless')()
const metascraper = require('metascraper')([
    require('metascraper-description')(),
    require('metascraper-image')(),
    require('metascraper-title')()
])


const getContent = async (url: string) => {
    // create a browser context inside the main Chromium process
    const browserContext = browserless.createContext()
    const promise = getHTML(url, { getBrowserless: () => browserContext })
    // close browser resources before return the result
    promise.then(() => browserContext).then((browser: any) => browser.destroyContext())
    return promise
}

export const fetchURLMetadata : CAHandler<{query: {url: string}}, {title?: string, description?: string, thumb?: string}> = async (ctx, agent, {query}) => {
    const { url } = query

    if (!url) return {error: "Falta el URL."}

    try {

        const metadata = await getContent(url).then(metascraper)

        return {data: {
                title: metadata.title ?? null,
                description: metadata.description ?? null,
                thumb: metadata.image ?? null,
            }}
    } catch (err) {
        console.error('Metadata scrape failed:', err);
        return {error: "Error al obtener los metadatos."}
    }
}