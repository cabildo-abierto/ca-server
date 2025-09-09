import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const ModerationState = {
    Ok: "Ok",
    ShadowBan: "ShadowBan"
} as const;
export type ModerationState = (typeof ModerationState)[keyof typeof ModerationState];
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
    Payed: "Payed"
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
export const NotificationType = {
    Reply: "Reply",
    Mention: "Mention",
    TopicEdit: "TopicEdit",
    TopicVersionVote: "TopicVersionVote"
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export type AccessRequest = {
    id: string;
    created_at: Generated<Timestamp>;
    email: string;
    comment: string;
    sentInviteAt: Timestamp | null;
    inviteCodeId: string | null;
};
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
export type Content = {
    uri: string;
    text: string | null;
    textBlobId: string | null;
    format: string | null;
    dbFormat: string | null;
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
export type Donation = {
    id: string;
    created_at: Generated<Timestamp>;
    userById: string | null;
    transactionId: string | null;
    amount: number;
    mpPreferenceId: string | null;
};
export type Draft = {
    id: string;
    created_at: Generated<Timestamp>;
    lastUpdate: Generated<Timestamp>;
    collection: string;
    text: string;
    title: string | null;
    embeds: unknown | null;
    authorId: string;
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
    created_at: Generated<Timestamp | null>;
};
export type Meeting = {
    id: string;
    date: Timestamp;
    title: string;
    url: string;
    description: string;
    show: Generated<boolean>;
};
export type Notification = {
    id: string;
    created_at: Generated<Timestamp>;
    type: NotificationType;
    userNotifiedId: string;
    causedByRecordId: string;
    message: string | null;
    moreContext: string | null;
    reasonSubject: string | null;
};
export type NotInterested = {
    id: string;
    authorId: string;
    subjectId: string;
};
export type PaymentPromise = {
    id: string;
    created_at: Generated<Timestamp>;
    userMonthId: string;
    amount: number;
    status: Generated<PromiseStatus>;
    contentId: string;
};
export type Post = {
    uri: string;
    facets: string | null;
    embed: string | null;
    replyToId: string | null;
    quote: string | null;
    rootId: string | null;
    langs: string[];
};
export type Reaction = {
    uri: string;
    subjectId: string | null;
};
export type ReadSession = {
    id: string;
    userId: string;
    created_at: Generated<Timestamp>;
    readChunks: unknown;
    readContentId: string | null;
    contentAuthorId: string;
    topicId: string | null;
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
    CAIndexedAt: Generated<Timestamp>;
    lastUpdatedAt: Generated<Timestamp>;
};
export type Reference = {
    id: string;
    type: ReferenceType;
    count: Generated<number>;
    referencedTopicId: string;
    referencingContentId: string;
};
export type Topic = {
    id: string;
    protection: Generated<EditorStatus>;
    currentVersionId: string | null;
    popularityScore: Generated<number | null>;
    popularityScoreLastDay: Generated<number>;
    popularityScoreLastWeek: Generated<number>;
    popularityScoreLastMonth: Generated<number>;
    lastEdit: Timestamp | null;
    lastContentChange: Timestamp | null;
};
export type TopicCategory = {
    id: string;
};
export type TopicInteraction = {
    recordId: string;
    topicId: string;
    touched: Generated<Timestamp>;
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
    prevAcceptedUri: string | null;
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
    created_at: Generated<Timestamp>;
    editorStatus: Generated<EditorStatus>;
    platformAdmin: Generated<boolean>;
    seenTutorial: Generated<boolean>;
    seenTopicsTutorial: Generated<boolean>;
    seenTopicMinimizedTutorial: Generated<boolean>;
    seenTopicMaximizedTutorial: Generated<boolean>;
    authorStatus: unknown | null;
    userValidationHash: string | null;
    orgValidation: string | null;
    lastSeenNotifications: Generated<Timestamp>;
    moderationState: Generated<ModerationState>;
    algorithmConfig: unknown | null;
    articleLastMonth: Generated<boolean>;
    postLastTwoWeeks: Generated<boolean>;
};
export type UserMonth = {
    id: string;
    userId: string;
    monthStart: Timestamp;
    monthEnd: Timestamp;
    wasActive: boolean;
    value: number;
    promisesCreated: Generated<boolean>;
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
export type VoteReject = {
    uri: string;
    message: string | null;
    labels: string[];
};
export type DB = {
    _ContentToDataset: ContentToDataset;
    AccessRequest: AccessRequest;
    Article: Article;
    AuthSession: AuthSession;
    AuthState: AuthState;
    Blob: Blob;
    CategoryLink: CategoryLink;
    Content: Content;
    DataBlock: DataBlock;
    Dataset: Dataset;
    Donation: Donation;
    Draft: Draft;
    Follow: Follow;
    HasReacted: HasReacted;
    InviteCode: InviteCode;
    Meeting: Meeting;
    Notification: Notification;
    NotInterested: NotInterested;
    PaymentPromise: PaymentPromise;
    Post: Post;
    Reaction: Reaction;
    ReadSession: ReadSession;
    Record: Record;
    Reference: Reference;
    Topic: Topic;
    TopicCategory: TopicCategory;
    TopicInteraction: TopicInteraction;
    TopicToCategory: TopicToCategory;
    TopicVersion: TopicVersion;
    User: User;
    UserMonth: UserMonth;
    ValidationRequest: ValidationRequest;
    VoteReject: VoteReject;
};
