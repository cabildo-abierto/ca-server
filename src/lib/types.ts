import {EditorStatus} from "@prisma/client";
import {AlgorithmConfig} from "#/services/user/users";
import {MirrorStatus} from "#/services/redis/cache";


export type ATProtoStrongRef = {
    uri: string
    cid: string
}

export type ValidationState = "org" | "persona" | null

export type CAProfileDetailed = {
    did: string
    caProfile: string | null
    followersCount: number
    followsCount: number
    articlesCount: number
    editsCount: number
    editorStatus: EditorStatus
    verification: ValidationState
}


export type CAProfile = {
    did: string
    avatar: string | null
    handle: string
    displayName: string | null
    createdAt: Date
    caProfile: string | null
    editorStatus: EditorStatus
    verification: ValidationState
    description: string | null
    viewer: {
        following: string | null,
        followedBy: string | null
    }
}


export type AuthorStatus = {
    isAuthor: boolean
    seenAuthorTutorial: boolean
}

export type Session = {
    platformAdmin: boolean
    authorStatus: AuthorStatus | null
    editorStatus: EditorStatus
    seenTutorial: {
        topics: boolean
        home: boolean
        topicMinimized: boolean
        topicMaximized: boolean
    }
    handle: string
    displayName: string | null
    avatar: string | null
    did: string
    hasAccess: boolean
    validation: ValidationState
    algorithmConfig: AlgorithmConfig
    mirrorStatus: MirrorStatus
}


export type Account = {
    email?: string
}


export type TopicsGraph = {
    nodeIds: string[]
    edges: {x: string, y: string}[]
    data?: {id: string, categorySize?: number}[]
}


export type PlotConfigProps = {
    datasetUri?: string
    filters?: FilterProps[]
    kind?: string
    [key: string]: any
}


export type FilterProps = {
    value: any
    op: string
    column: string
}


export type JetstreamEvent = {
    did: string
    kind: "commit" | "update" | "identity" | "account"
    time_us: number
}



export type CommitEvent = JetstreamEvent & {
    commit: {
        collection: string
        operation: "create" | "delete" | "update"
        rkey: string
        cid: string
        record?: any
    }
}