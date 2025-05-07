import {EditorStatus} from "@prisma/client";
import {ProfileViewDetailed} from "@atproto/api/dist/client/types/app/bsky/actor/defs";



export type ATProtoStrongRef = {
    uri: string
    cid: string
}


export type Profile = {
    bsky: ProfileViewDetailed
    ca: CAProfile | null
}

export type CAProfile = {
    inCA: boolean
    followersCount: number
    followsCount: number
    editorStatus: EditorStatus
}


export type Session = {
    platformAdmin: boolean
    editorStatus: EditorStatus
    seenTutorial: boolean
    handle: string
    displayName: string | null
    avatar: string | null
    did: string
    hasAccess: boolean
}


export type Account = {
    email?: string
}


export type TopicsGraph = {
    nodeIds: string[]
    edges: {x: string, y: string}[]
    nodeLabels?: {id: string, label: string}[]
}


export type MentionProps = {
    did: string
    handle: string
    displayName?: string
    avatar?: string
}


export type FeedEngagementProps = {
    likes: {likedRecordId: string | null; uri: string}[]
    reposts: {repostedRecordId: string | null; uri: string}[]
}


export type SubscriptionProps = {
    id: string
    userId?: string
    createdAt: Date
    boughtByUserId: string
    usedAt: Date | null
    endsAt: Date | null
    price: number
}


export type UserStats = {
    posts: number
    entityEdits: number
    editedEntities: number
    reactionsInPosts: number
    reactionsInEntities: number
    income: number
    pendingConfirmationIncome: number
    pendingPayIncome: number
    entityAddedChars: number
    viewsInPosts: number
    viewsInEntities: number
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
        operation: "create" | "delete"
        rkey: string
        cid: string
        uri: string
        record?: {
            createdAt?: string
            reply?: any
        }
    }
}


export type UserRepo = {
    did: string
    uri: string
    collection: string
    rkey: string
    record: any
    cid: string
}[]