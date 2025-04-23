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


export type TopicProps = {
    id: string
    protection: EditorStatus
    synonyms: string[]
    categories: {
        categoryId: string
    }[]
    currentVersion: {
        uri: string
        content: {
            text: string
            format?: string
            record: {
                cid: string
                author: {
                    did: string
                    handle: string
                    displayName?: string
                    avatar?: string
                }
                createdAt: Date
            }
        }
    }
}


export type TopicHistoryProps = {
    id: string
    versions: {
        uri: string
        cid: string | null
        collection: "ar.cabildoabierto.wiki.topicVersion" | null
        author: {
            did: string
            handle: string | null
            displayName: string | null
            avatar: string | null
        }
        content: {
            hasText: boolean
            topicVersion: {
                charsAdded?: number | null
                charsDeleted?: number | null
                accCharsAdded?: number | null
                contribution?: string | null
                message?: string | null
                diff?: string | null
                title?: string | null
                categories?: string | null
                synonyms?: string | null
            }
        }
        createdAt: Date
        uniqueAccepts: number
        uniqueRejects: number
    }[]
}


export type TopicVersionAuthorsProps = {
    text: string
}


export type SmallTopicProps = {
    id: string
    popularityScore: number | null
    synonyms: string[] | null
    categories: {
        categoryId: string
    }[]
    lastEdit: Date | null
}


export type TopicSortOrder = "popular" | "recent"


export type TopicsGraph = {
    nodeIds: string[]
    edges: {x: string, y: string}[]
    nodeLabels?: {id: string, label: string}[]
}


export type ReasonProps = {
    createdAt: Date
    collection: Collection
    by: SmallUserProps
}


export type FeedContentProps =
    (FastPostProps | ArticleProps | DatasetProps | VisualizationProps | TopicVersionOnFeedProps) &
    Omit<RecordProps, "collection"> &
    EngagementProps &
    {reason?: ReasonProps}



export type FeedContentPropsMaybe = FeedContentProps & {blocked?: boolean, notFound?: boolean}


export type MentionProps = SmallUserProps & {
    value: string
}


export type SmallUserProps = ProfileViewBasic & {
    CAProfileUri?: string
}


export type BothContributionsProps = {
    monetized: [string, number][]
    all: [string, number][]
}


export type ContributionsProps = [string, number][]


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


export type UserProps = {
    did: string
    handle: string
    displayName?: string
    avatar?: string
    banner?: string
    description?: string
    hasAccess: boolean
    email?: string
    inCA: boolean
    CAProfileUri?: string
    createdAt: Date
    seenTutorial: boolean
    editorStatus: EditorStatus
    platformAdmin: boolean
    subscriptionsUsed: SubscriptionProps[]
    subscriptionsBought: {id: string, price: number}[]
    viewer?: {following?: string, followed?: string}
    followersCount: number
    followsCount: number
    messagesSent: MessageProps[]
    messagesReceived: MessageProps[]
    usedInviteCode?: {
        code: string
    }
};


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


export type ArticleProps = RecordProps & EngagementProps & {
    content: {
        text?: string
        textBlob?: {cid: string, authorId: string}
        format?: string
        numWords?: number
        article: {
            title: string
        }
        references: {
            referencedTopicId: string
            count: number
        }[]
    }
} & {collection: "ar.com.cabildoabierto.article"}

export type EngagementProps = {
    likeCount?: number
    repostCount?: number
    replyCount?: number
    viewer?: {like?: string, repost?: string}
    participantsCount?: number
    uniqueViewsCount?: number
    visualizationsUsingCount?: number
    likeCountBsky?: number
    repostCountBsky?: number
    quoteCountBsky?: number
}

export type FastPostProps = RecordProps & EngagementProps & {
    content: {
        text: string
        post: {
            facets?: string
            embed?: string
            replyTo?: (FeedContentPropsMaybe | ATProtoStrongRef) & {collection?: string, uri: string, notFound?: boolean}
            root?: (FeedContentPropsMaybe | ATProtoStrongRef) & {collection?: string, uri: string, notFound?: boolean}
            grandparentAuthor?: SmallUserProps
            quote?: string
            visualization?: VisualizationProps
        }
    }
} & {collection: "ar.com.cabildoabierto.quotePost" | "app.bsky.feed.post"}


export type ThreadReplyProps = FastPostProps & {
    content: {
        post: {
            replyTo: {
                text?: string
            }
        }
    }
}


export type TopicVersionOnFeedProps = RecordProps & EngagementProps & {
    content: {
        numWords?: number
        topicVersion: {
            title?: string
            topic: {
                id: string
            }
            message?: string
            charsAdded?: number
            charsDeleted?: number
        }
    }
} & {collection: "ar.com.cabildoabierto.topic"}

export type ThreadProps = {
    post: FeedContentProps
    replies?: FastPostProps[]
}

export type MatchesType = {
    matches: {x: number, y: number}[]
    common: {x: number, y: number}[]
    perfectMatches: {x: number, y: number}[]
}


export type DatasetProps = RecordProps & {
    dataset: {
        title: string
        columns: string[]
        columnValues: {column: string, values: any[]}[] | Map<string, any[]> | null
        description: string | null
        dataBlocks: {
            record: RecordProps,
            format: string,
            blob: {
                cid: string
                authorId: string
            }
        }[]
    }
    visualizationsUsing: {
        uri: string
    }[]
} & {collection: "ar.cabildoabierto.data.dataset"}


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


export type SyncRecordProps = {
    did: string
    uri: string
    collection: string
    rkey: string
    cid: string
    record: any
}


export type UserRepo = {
    did: string
    uri: string
    collection: string
    rkey: string
    record: any
    cid: string
}[]