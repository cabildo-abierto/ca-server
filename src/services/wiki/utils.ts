import {
    isStringListProp,
    isStringProp,
    TopicProp
} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js";
import {gett, unique} from "#/utils/arrays.js";
import {cleanText} from "#/utils/strings.js";


export function getTopicCategories(props?: TopicProp[], topicCategories?: string[], currentVersionCategories?: string): string[] {
    const c = getTopicProp("Categorías", props)
    const propsCategories = c && isStringListProp(c.value) ? c.value.value : []

    return unique([
        ...propsCategories,
        ...(topicCategories ?? []),
        ...(currentVersionCategories ? JSON.parse(currentVersionCategories) : []) // deprecated
    ])
}


export function getTopicProp(prop: string, props?: TopicProp[]): TopicProp | null {
    const d = getPropsDict(props)
    if(d.has(prop)){
        return gett(d, prop)
    } else {
        return null
    }
}


export function getTopicTitle(topic: {id: string, props?: TopicProp[]}): string {
    const t = getTopicProp("Título", topic.props)
    return t && isStringProp(t.value) ? t.value.value : topic.id
}


export function getTopicSynonyms(topic: {id: string, props?: TopicProp[]}): string[] {
    const s = getTopicProp("Sinónimos", topic.props)

    return s && isStringListProp(s.value) ? unique(s.value.value, cleanText) : []
}


export function getPropsDict(props?: TopicProp[]) {
    if(!props) return new Map<string, TopicProp>()
    return new Map<string, TopicProp>(props.map(p => [p.name, p]))
}