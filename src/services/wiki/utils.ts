import {
    isStringListProp,
    isStringProp,
    StringListProp,
    StringProp,
    TopicProp,
    TopicVersionStatus
} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {areArraysEqual, gett, unique} from "#/utils/arrays";
import {$Typed} from "@atproto/api";
import {EditorStatus} from "@prisma/client";
import {cleanText} from "#/utils/strings";


export function currentCategories(topic: {
    versions: { categories: string | null, content: { record: { createdAt: Date } } }[]
}) {
    let last = null
    for (let i = 0; i < topic.versions.length; i++) {
        if (topic.versions[i].categories != null) {
            const date = new Date(topic.versions[i].content.record.createdAt).getTime()
            if (last == null || new Date(topic.versions[last].content.record.createdAt).getTime() < date) {
                last = i
            }
        }
    }
    if (last == null) return []

    const lastCat = topic.versions[last].categories
    return lastCat ? (JSON.parse(lastCat) as string[]) : []
}


export type PropValueType = "ar.cabildoabierto.wiki.topicVersion#stringListProp"
    | "ar.cabildoabierto.wiki.topicVersion#stringProp"

export type PropValue = $Typed<StringListProp> | $Typed<StringProp> | {$type: string}

export function isKnownProp(p: PropValue): p is $Typed<StringListProp> | $Typed<StringProp> {
    return p.$type == "ar.cabildoabierto.wiki.topicVersion#stringListProp" ||
        p.$type == "ar.cabildoabierto.wiki.topicVersion#stringProp"
}

export function propsEqualValue(a: PropValue, b: PropValue) {
    if(a.$type != b.$type) return false
    if(isStringListProp(a) && isStringListProp(b)){
        return areArraysEqual(a.value, b.value)
    } else if(isStringProp(a) && isStringProp(b)){
        return a.value == b.value
    }
}


export function getTopicCategories(props?: TopicProp[], topicCategories?: string[], currentVersionCategories?: string): string[] {
    const c = getTopicProp("Categorías", props)
    const propsCategories = c && isStringListProp(c.value) ? c.value.value : []

    return unique([
        ...propsCategories,
        ...(topicCategories ?? []),
        ...(currentVersionCategories ? JSON.parse(currentVersionCategories) : []) // deprecated
    ])
}


export function getAcceptCount(status: TopicVersionStatus){
    let accepts = 0
    status.voteCounts.forEach(v => {
        accepts += v.accepts
    })
    return accepts
}


export function getRejectCount(status: TopicVersionStatus){
    let rejects = 0
    status.voteCounts.forEach(v => {
        rejects += v.rejects
    })
    return rejects
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


export function getTopicSynonyms(topic: {id: string, synonyms?: string[], props?: TopicProp[]}): string[] {
    const s = getTopicProp("Sinónimos", topic.props)
    const t = getTopicProp("Título", topic.props)

    let synonyms = [topic.id]
    if(s && isStringListProp(s.value)){
        synonyms = [...synonyms, ...s.value.value]
    }
    if(t && isStringProp(t.value)) {
        synonyms.push(t.value.value)
    }

    if(topic.synonyms) synonyms = [...synonyms, ...topic.synonyms]

    return unique(synonyms, cleanText)
}


export function getTopicProtection(props: TopicProp[]): string {
    const p = getTopicProp("Protección", props)
    return p && isStringProp(p.value) ? p.value.value : "Principiante"
}


export function getPropsDict(props?: TopicProp[]) {
    if(!props) return new Map<string, TopicProp>()
    return new Map<string, TopicProp>(props.map(p => [p.name, p]))
}


export function isTopicVersionDemonetized(topicVersion: {}) {
    return false
}





export const permissionToPrintable = (level: string) => {
    if (level == "Administrator") {
        return "Administrador"
    } else if (level == "Beginner") {
        return "Editor aprendiz"
    } else if (level == "Editor") {
        return "Editor"
    }
}

export const permissionToNumber = (level: EditorStatus) => {
    if (level == "Administrator") {
        return 2
    } else if (level == "Beginner") {
        return 0
    } else if (level == "Editor") {
        return 1
    } else {
        throw Error("Nivel de permisos inválido:", level)
    }
}

export const hasEditPermission = (user: {editorStatus: EditorStatus} | null, level: EditorStatus) => {
    return user && permissionToNumber(user.editorStatus) >= permissionToNumber(level)
}
