import {CAHandler} from "#/utils/handler";
import {ArticleEmbed} from "#/lex-api/types/ar/cabildoabierto/feed/article";
import {diff, nodesCharDiff} from "#/services/wiki/diff";
import {getUri} from "#/utils/uri";
import {getTopicVersion} from "#/services/wiki/topics";
import {anyEditorStateToMarkdownOrLexical} from "#/utils/lexical/transforms";
import {ProfileViewBasic as ProfileViewBasicCA} from "#/lex-api/types/ar/cabildoabierto/actor/defs"


export const getNewVersionDiff: CAHandler<{currentText: string, currentFormat: string, markdown: string, embeds: ArticleEmbed[]}, {charsAdded: number, charsDeleted: number}> = async (ctx, agent, params) => {
    const nodes1 = anyEditorStateToNodesForDiff(params.currentText, params.currentFormat)
    const nodes2 = anyEditorStateToNodesForDiff(params.markdown, "markdown")

    if(!nodes1 || !nodes2){
        return {error: "No se pudo procesar una de las versiones."}
    }

    const d = nodesCharDiff(nodes1, nodes2, true)

    return {
        data: {
            charsAdded: d?.charsAdded,
            charsDeleted: d?.charsDeleted
        }
    }
}


export type MatchesType = {
    matches: {x: number, y: number}[]
    common: {x: number, y: number}[]
    perfectMatches: {x: number, y: number}[]
}

export type TopicVersionChangesProps = {
    prevText: string
    prevFormat: string | undefined
    curText: string
    curFormat: string | undefined
    curAuthor: ProfileViewBasicCA
    prevAuthor: ProfileViewBasicCA
    diff: MatchesType
}


function anyEditorStateToNodesForDiff(text: string, format?: string | null) {
    const mdOrLexical = anyEditorStateToMarkdownOrLexical(text, format)
    if (mdOrLexical.format == "lexical"){
        return null
    } else {
        return mdOrLexical.text.split("\n\n")
    }
}


export const getTopicVersionChanges: CAHandler<{
    params: { curDid: string, curRkey: string, prevDid: string, prevRkey: string }
}, TopicVersionChangesProps> = async (ctx, agent, {params}) => {
    const {curDid, prevDid, curRkey, prevRkey} = params

    const curUri = getUri(curDid, "ar.cabildoabierto.wiki.topicVersion", curRkey)
    const prevUri = getUri(prevDid, "ar.cabildoabierto.wiki.topicVersion", prevRkey)
    const cur = await getTopicVersion(ctx, curUri)
    const prev = await getTopicVersion(ctx, prevUri)

    if(!cur.data || !prev.data){
        return {error: "No se encontró una de las versiones."}
    }

    const nodes1 = anyEditorStateToNodesForDiff(prev.data.text, prev.data.format)
    const nodes2 = anyEditorStateToNodesForDiff(cur.data.text, cur.data.format)

    if(!nodes1 || !nodes2){
        return {error: "No se pudo procesar una de las versiones."}
    }

    const d = diff(nodes1, nodes2, true)

    return {
        data: {
            curText: cur.data.text,
            curFormat: cur.data.format,
            prevText: prev.data.text,
            prevFormat: prev.data.format,
            curAuthor: cur.data.author,
            prevAuthor: prev.data.author,
            diff: d
        }
    }
}