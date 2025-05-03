import removeMarkdown from "remove-markdown";
import {decompress} from "../compression";


export function markdownToPlainText(md: string) {
    const res = removeMarkdown(md).replace(/\n{2,}/g, '\n').trim()
    return res
}


export function htmlToEditorStateStr(html: string){
    const TurndownService = require('turndown');
    const turndownService = new TurndownService();
    return turndownService.turndown(html)
}


export function anyEditorStateToMarkdownOrLexical(text: string | null, format: string): {text: string, format: string} {
    if(!text) {
        return {text: "", format: "markdown"}
    } else if (format == "markdown") {
        return {text, format: "markdown"}
    } else if (format == "lexical") {
        return {text, format: "lexical"}
    } else if (format == "lexical-compressed") {
        return anyEditorStateToMarkdownOrLexical(decompress(text), "lexical")
    } else if (format == "markdown-compressed") {
        return anyEditorStateToMarkdownOrLexical(decompress(text), "markdown")
    } else if (format == "html") {
        return anyEditorStateToMarkdownOrLexical(htmlToEditorStateStr(text), "lexical")
    } else if (format == "html-compressed") {
        return anyEditorStateToMarkdownOrLexical(decompress(text), "html")
    } else if (!format) {
        return anyEditorStateToMarkdownOrLexical(text, "lexical-compressed")
    } else {
        throw Error("Formato de contenido desconocido: " + format)
    }
}