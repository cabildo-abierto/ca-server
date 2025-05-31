import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const MirrorStatus = {
    Dirty: "Dirty",
    InProcess: "InProcess",
    Sync: "Sync",
    Failed: "Failed"
} as const;
export type MirrorStatus = (typeof MirrorStatus)[keyof typeof MirrorStatus];
export const ValidationType = {
    Persona: "Persona",
    Organizacion: "Organizacion"
} as const;
export type ValidationType = (typeof ValidationType)[keyof typeof ValidationType];
export const ValidationRequestResult = {
    Aceptada: "Aceptada",
    Rechazada: "Rechazada",
    Pendiente: "Pendiente"
} as const;
export type ValidationRequestResult = (typeof ValidationRequestResult)[keyof typeof ValidationRequestResult];
export const PromiseStatus = {
    Pending: "Pending",
    Confirmed: "Confirmed",
    Canceled: "Canceled"
} as const;
export type PromiseStatus = (typeof PromiseStatus)[keyof typeof PromiseStatus];
export const ReferenceType = {
    Strong: "Strong",
    Weak: "Weak"
} as const;
export type ReferenceType = (typeof ReferenceType)[keyof typeof ReferenceType];
export const EditorStatus = {
    Beginner: "Beginner",
    Editor: "Editor",
    Administrator: "Administrator"
} as const;
export type EditorStatus = (typeof EditorStatus)[keyof typeof EditorStatus];
export type Article = {
    uri: string;
    title: string;
};
export type AuthSession = {
    key: string;
    session: string;
};
export type AuthState = {
    key: string;
    state: string;
};
export type Blob = {
    cid: string;
    authorId: string;
};
export type CategoryLink = {
    idCategoryA: string;
    idCategoryB: string;
};
export type ChatMessage = {
    id: string;
    created_at: Generated<Timestamp>;
    fromUserId: string;
    toUserId: string;
    text: string;
    seen: Generated<boolean>;
};
export type Content = {
    uri: string;
    text: string | null;
    textBlobId: string | null;
    format: Generated<string>;
    numWords: number | null;
    lastReferencesUpdate: Timestamp | null;
    selfLabels: string[];
    embeds: unknown[];
};
export type ContentToDataset = {
    A: string;
    B: string;
};
export type DataBlock = {
    cid: string;
    datasetId: string;
    format: string | null;
};
export type Dataset = {
    uri: string;
    columns: string[];
    title: string;
    description: string | null;
};
export type Follow = {
    uri: string;
    userFollowedId: string | null;
};
export type HasReacted = {
    id: string;
    userId: string;
    recordId: string;
    reactionType: string;
};
export type InviteCode = {
    code: string;
    usedByDid: string | null;
    usedAt: Timestamp | null;
    recommenderId: string | null;
};
export type PaymentPromise = {
    id: string;
    created_at: Generated<Timestamp>;
    authorId: string;
    subscriptionId: string;
    amount: number;
    contentUri: string;
    status: Generated<PromiseStatus>;
};
export type Post = {
    uri: string;
    facets: string | null;
    embed: string | null;
    replyToId: string | null;
    quote: string | null;
    rootId: string | null;
};
export type Reaction = {
    uri: string;
    subjectId: string | null;
};
export type Record = {
    uri: string;
    cid: string | null;
    collection: string;
    rkey: string;
    authorId: string;
    created_at: Generated<Timestamp>;
    record: string | null;
    uniqueLikesCount: Generated<number>;
    uniqueRepostsCount: Generated<number>;
    uniqueAcceptsCount: Generated<number>;
    uniqueRejectsCount: Generated<number>;
    uniqueViewsCount: Generated<number>;
};
export type Reference = {
    id: string;
    type: ReferenceType;
    count: Generated<number>;
    referencedTopicId: string;
    referencingContentId: string;
};
export type Subscription = {
    id: string;
    userId: string | null;
    created_at: Generated<Timestamp>;
    boughtByUserId: string;
    usedAt: Timestamp | null;
    price: number;
    paymentId: string | null;
    endsAt: Timestamp | null;
    promisesCreated: Generated<boolean>;
};
export type Topic = {
    id: string;
    protection: Generated<EditorStatus>;
    currentVersionId: string | null;
    synonyms: string[];
    lastSynonymsChange: Timestamp | null;
    popularityScore: Generated<number | null>;
    lastEdit: Timestamp | null;
};
export type TopicCategory = {
    id: string;
};
export type TopicToCategory = {
    topicId: string;
    categoryId: string;
};
export type TopicVersion = {
    uri: string;
    title: string | null;
    topicId: string;
    message: Generated<string>;
    synonyms: string | null;
    categories: string | null;
    authorship: Generated<boolean>;
    charsAdded: number | null;
    charsDeleted: number | null;
    accCharsAdded: number | null;
    contribution: string | null;
    diff: string | null;
    props: unknown | null;
};
export type User = {
    did: string;
    handle: string | null;
    displayName: string | null;
    avatar: string | null;
    banner: string | null;
    email: string | null;
    description: string | null;
    hasAccess: Generated<boolean>;
    inCA: Generated<boolean>;
    CAProfileUri: string | null;
    mirrorStatus: Generated<MirrorStatus>;
    created_at: Generated<Timestamp>;
    editorStatus: Generated<EditorStatus>;
    platformAdmin: Generated<boolean>;
    seenTutorial: Generated<boolean>;
    userValidationHash: string | null;
    orgValidation: string | null;
};
export type ValidationRequest = {
    id: string;
    type: ValidationType;
    userId: string;
    dniFrente: string | null;
    dniDorso: string | null;
    tipoOrg: string | null;
    sitioWeb: string | null;
    comentarios: string | null;
    email: string | null;
    documentacion: string[];
    created_at: Generated<Timestamp>;
    result: Generated<ValidationRequestResult>;
    rejectReason: string | null;
};
export type View = {
    id: string;
    created_at: Generated<Timestamp>;
    userById: string;
    recordId: string | null;
};
export type Visualization = {
    uri: string;
    spec: string;
    datasetId: string | null;
    previewBlobCid: string | null;
};
export type VoteReject = {
    uri: string;
    message: string | null;
    labels: string[];
};
export type DB = {
    _ContentToDataset: ContentToDataset;
    Article: Article;
    AuthSession: AuthSession;
    AuthState: AuthState;
    Blob: Blob;
    CategoryLink: CategoryLink;
    ChatMessage: ChatMessage;
    Content: Content;
    DataBlock: DataBlock;
    Dataset: Dataset;
    Follow: Follow;
    HasReacted: HasReacted;
    InviteCode: InviteCode;
    PaymentPromise: PaymentPromise;
    Post: Post;
    Reaction: Reaction;
    Record: Record;
    Reference: Reference;
    Subscription: Subscription;
    Topic: Topic;
    TopicCategory: TopicCategory;
    TopicToCategory: TopicToCategory;
    TopicVersion: TopicVersion;
    User: User;
    ValidationRequest: ValidationRequest;
    View: View;
    Visualization: Visualization;
    VoteReject: VoteReject;
};
