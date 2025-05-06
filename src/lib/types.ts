import {EditorStatus} from "@prisma/client";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";
import {ProfileViewDetailed} from "@atproto/api/dist/client/types/app/bsky/actor/defs";


export type Collection =
    PostCollection |
    "ar.com.cabildoabierto.article" |
    "ar.com.cabildoabierto.topic" |
    "ar.com.cabildoabierto.vote" |
    "ar.com.cabildoabierto.visualization" |
    "ar.com.cabildoabierto.dataset" |
    "ar.com.cabildoabierto.dataBlock" |
    "app.bsky.feed.repost" |
    "app.bsky.feed.like"

export type PostCollection =
    "ar.com.cabildoabierto.quotePost" |
    "app.bsky.feed.post"


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


export type RecordProps = {
    uri: string
    cid: string
    collection: Collection
    createdAt: Date
    rkey: string
    author: {
        did: string
        handle: string
        displayName?: string
        avatar?: string
        inCA?: boolean
    }
    enDiscusion?: {
        uri: string
    }
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


export type MessageProps = {
    createdAt: Date,
    id: string,
    text: string,
    fromUserId: string,
    toUserId: string,
    seen: boolean
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


export type VisualizationProps = RecordProps & {
    visualization: {
        spec: string
        dataset?: {
            uri: string
            dataset: {
                title: string
            }
        }
        previewBlobCid?: string
    }
} & {collection: "ar.com.cabildoabierto.visualization"}


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