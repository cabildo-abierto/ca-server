import removeMarkdown from "remove-markdown";
import {decompress} from "../compression";


export function markdownToPlainText(md: string) {
    const res = removeMarkdown(md).replace(/\n{2,}/g, '\n').trim()
    return res
}


export function htmlToMarkdown(html: string){
    const { JSDOM } = require('jsdom');

    const dom = new JSDOM(html);
    const document = dom.window.document;

    ['b', 'i', 'strong', 'em'].forEach(tag => {
        const elements = document.querySelectorAll(tag);
        elements.forEach((el: any) => {
            if (Array.from(el.children).some((child: any) => ['P', 'DIV'].includes(child.tagName))) {
                const parent = el.parentNode;
                while (el.firstChild) {
                    parent.insertBefore(el.firstChild, el);
                }
                parent.removeChild(el);
            }
        });
    });

    const TurndownService = require('turndown');
    console.log("HTML:", html)
    const turndownService = new TurndownService();
    turndownService.addRule('ignoreHr', {
        filter: 'hr',
        replacement: () => ''
    });
    const md = turndownService.turndown(document.body.innerHTML)
    console.log("MD:", md)
    return md
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
        return anyEditorStateToMarkdownOrLexical(htmlToMarkdown(text), "markdown")
    } else if (format == "html-compressed") {
        return anyEditorStateToMarkdownOrLexical(decompress(text), "html")
    } else if (!format) {
        return anyEditorStateToMarkdownOrLexical(text, "lexical-compressed")
    } else {
        throw Error("Formato de contenido desconocido: " + format)
    }
}