import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const MailingListSubscriptionStatus = {
    Subscribed: "Subscribed",
    Unsubscribed: "Unsubscribed"
} as const;
export type MailingListSubscriptionStatus = (typeof MailingListSubscriptionStatus)[keyof typeof MailingListSubscriptionStatus];
export const EditorStatus = {
    Beginner: "Beginner",
    Editor: "Editor",
    Administrator: "Administrator"
} as const;
export type EditorStatus = (typeof EditorStatus)[keyof typeof EditorStatus];
export const ModerationState = {
    Ok: "Ok",
    ShadowBan: "ShadowBan"
} as const;
export type ModerationState = (typeof ModerationState)[keyof typeof ModerationState];
export const NotificationType = {
    Reply: "Reply",
    Mention: "Mention",
    TopicEdit: "TopicEdit",
    TopicVersionVote: "TopicVersionVote"
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
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
export const ValidationRequestResult = {
    Aceptada: "Aceptada",
    Rechazada: "Rechazada",
    Pendiente: "Pendiente"
} as const;
export type ValidationRequestResult = (typeof ValidationRequestResult)[keyof typeof ValidationRequestResult];
export const ValidationType = {
    Persona: "Persona",
    Organizacion: "Organizacion"
} as const;
export type ValidationType = (typeof ValidationType)[keyof typeof ValidationType];
export type AccessRequest = {
    id: string;
    created_at: Generated<Timestamp>;
    created_at_tz: Generated<Timestamp>;
    email: string;
    comment: string;
    sentInviteAt: Timestamp | null;
    sentInviteAt_tz: Timestamp | null;
    inviteCodeId: string | null;
};
export type Article = {
    title: string;
    uri: string;
};
export type AssignedPayment = {
    id: string;
    created_at: Generated<Timestamp>;
    amount: number;
    status: Generated<PromiseStatus>;
    contentId: string;
    userMonthId: string | null;
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
    text: string | null;
    numWords: number | null;
    uri: string;
    format: string | null;
    textBlobId: string | null;
    selfLabels: string[];
    embeds: unknown[];
    dbFormat: string | null;
    created_at: Generated<Timestamp>;
    created_at_tz: Timestamp | null;
    interactionsScore: number | null;
    likesScore: number | null;
    relativePopularityScore: number | null;
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
    columns: string[];
    title: string;
    uri: string;
    description: string | null;
};
export type DiscoverFeedIndex = {
    contentId: string;
    categoryId: string;
    created_at: Timestamp;
};
export type Donation = {
    id: string;
    userById: string | null;
    created_at: Generated<Timestamp>;
    created_at_tz: Generated<Timestamp>;
    transactionId: string | null;
    amount: number;
    mpPreferenceId: string | null;
};
export type Draft = {
    id: string;
    created_at: Generated<Timestamp>;
    created_at_tz: Generated<Timestamp>;
    lastUpdate: Generated<Timestamp>;
    lastUpdate_tz: Generated<Timestamp>;
    authorId: string;
    collection: string;
    embeds: unknown | null;
    text: string;
    title: string | null;
};
export type EmailSent = {
    id: string;
    recipientId: string;
    sent_at: Generated<Timestamp>;
    text: string;
    html: string;
    subject: string;
    success: boolean;
    from: string;
    template_name: string;
};
export type Follow = {
    userFollowedId: string | null;
    uri: string;
};
export type HasReacted = {
    userId: string;
    recordId: string;
    reactionType: string;
    id: string;
};
export type InviteCode = {
    code: string;
    usedByDid: string | null;
    usedAt: Timestamp | null;
    usedAt_tz: Timestamp | null;
    recommenderId: string | null;
    created_at: Generated<Timestamp>;
    created_at_tz: Generated<Timestamp>;
};
export type JobApplication = {
    id: string;
    created_at: Generated<Timestamp>;
    name: string;
    email: string;
    comment: string;
    cv: string | null;
    job: string;
};
export type MailingListSubscription = {
    id: string;
    email: string;
    status: Generated<MailingListSubscriptionStatus>;
    userId: string | null;
    subscribedAt: Generated<Timestamp>;
    updatedAt: Timestamp | null;
};
export type Meeting = {
    id: string;
    date: Timestamp;
    date_tz: Timestamp;
    title: string;
    url: string;
    description: string;
    show: Generated<boolean>;
};
export type Notification = {
    id: string;
    type: NotificationType;
    userNotifiedId: string;
    causedByRecordId: string;
    message: string | null;
    moreContext: string | null;
    created_at: Generated<Timestamp>;
    created_at_tz: Generated<Timestamp>;
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
    created_at_tz: Generated<Timestamp>;
    amount: number;
    status: Generated<PromiseStatus>;
    contentId: string;
    userMonthId: string | null;
};
export type Post = {
    facets: string | null;
    embed: string | null;
    replyToId: string | null;
    replyToCid: string | null;
    rootId: string | null;
    rootCid: string | null;
    uri: string;
    langs: string[];
    quoteToId: string | null;
    quoteToCid: string | null;
};
export type Reaction = {
    uri: string;
    subjectId: string | null;
    subjectCid: string | null;
};
export type ReadSession = {
    id: string;
    userId: string;
    created_at: Generated<Timestamp>;
    created_at_tz: Generated<Timestamp>;
    readContentId: string | null;
    readChunks: unknown;
    contentAuthorId: string;
    topicId: string | null;
};
export type Record = {
    uri: string;
    collection: string;
    rkey: string;
    authorId: string;
    created_at: Generated<Timestamp>;
    created_at_tz: Timestamp | null;
    record: string | null;
    cid: string | null;
    uniqueLikesCount: Generated<number>;
    uniqueRepostsCount: Generated<number>;
    uniqueAcceptsCount: Generated<number>;
    uniqueRejectsCount: Generated<number>;
    CAIndexedAt: Generated<Timestamp>;
    CAIndexedAt_tz: Timestamp | null;
    lastUpdatedAt: Generated<Timestamp>;
    lastUpdatedAt_tz: Timestamp | null;
    editedAt: Timestamp | null;
    quotesCount: Generated<number>;
};
export type Reference = {
    id: string;
    type: ReferenceType;
    referencedTopicId: string;
    referencingContentId: string;
    count: number | null;
    relevance: number | null;
    touched: Timestamp | null;
    touched_tz: Timestamp | null;
};
export type Timestamps = {
    id: string;
    date: Timestamp;
    date_tz: Timestamp | null;
};
export type Topic = {
    id: string;
    protection: Generated<EditorStatus>;
    currentVersionId: string | null;
    popularityScore: Generated<number | null>;
    lastEdit: Timestamp | null;
    lastEdit_tz: Timestamp | null;
    popularityScoreLastDay: Generated<number>;
    popularityScoreLastMonth: Generated<number>;
    popularityScoreLastWeek: Generated<number>;
    synonyms: string[];
};
export type TopicCategory = {
    id: string;
};
export type TopicInteraction = {
    id: string;
    recordId: string;
    referenceId: string;
    touched: Timestamp | null;
    touched_tz: Timestamp | null;
};
export type TopicToCategory = {
    topicId: string;
    categoryId: string;
};
export type TopicVersion = {
    topicId: string;
    accCharsAdded: number | null;
    authorship: Generated<boolean>;
    categories: string | null;
    charsAdded: number | null;
    charsDeleted: number | null;
    contribution: string | null;
    monetizedContribution: number | null;
    charsContribution: number | null;
    diff: string | null;
    message: Generated<string>;
    title: string | null;
    synonyms: string | null;
    uri: string;
    props: unknown | null;
    prevAcceptedUri: string | null;
    accepted: Generated<boolean>;
};
export type User = {
    did: string;
    handle: string | null;
    email: string | null;
    created_at: Generated<Timestamp>;
    created_at_tz: Timestamp | null;
    editorStatus: Generated<EditorStatus>;
    hasAccess: Generated<boolean>;
    avatar: string | null;
    banner: string | null;
    description: string | null;
    displayName: string | null;
    inCA: Generated<boolean>;
    platformAdmin: Generated<boolean>;
    CAProfileUri: string | null;
    seenTutorial: Generated<boolean>;
    orgValidation: string | null;
    userValidationHash: string | null;
    lastSeenNotifications: Generated<Timestamp>;
    lastSeenNotifications_tz: Generated<Timestamp | null>;
    moderationState: Generated<ModerationState>;
    seenTopicMaximizedTutorial: Generated<boolean>;
    seenTopicMinimizedTutorial: Generated<boolean>;
    seenTopicsTutorial: Generated<boolean>;
    seenVerifiedNotification: Generated<boolean>;
    algorithmConfig: unknown | null;
    authorStatus: unknown | null;
    articleLastMonth: Generated<boolean>;
    postLastTwoWeeks: Generated<boolean>;
};
export type UserInterest = {
    id: string;
    userId: string;
    topicCategoryId: string;
};
export type UserMonth = {
    id: string;
    userId: string;
    monthStart: Timestamp;
    monthEnd: Timestamp;
    wasActive: boolean;
    value: number;
    fullyConfirmed: Generated<boolean>;
};
export type ValidationRequest = {
    id: string;
    type: ValidationType;
    userId: string;
    dniFrente: string | null;
    dniDorso: string | null;
    comentarios: string | null;
    documentacion: string[];
    email: string | null;
    sitioWeb: string | null;
    tipoOrg: string | null;
    created_at: Generated<Timestamp>;
    created_at_tz: Generated<Timestamp>;
    rejectReason: string | null;
    result: Generated<ValidationRequestResult>;
};
export type VoteReject = {
    uri: string;
    labels: string[];
    message: string | null;
    reasonId: string | null;
};
export type DB = {
    _ContentToDataset: ContentToDataset;
    AccessRequest: AccessRequest;
    Article: Article;
    AssignedPayment: AssignedPayment;
    AuthSession: AuthSession;
    AuthState: AuthState;
    Blob: Blob;
    CategoryLink: CategoryLink;
    Content: Content;
    DataBlock: DataBlock;
    Dataset: Dataset;
    DiscoverFeedIndex: DiscoverFeedIndex;
    Donation: Donation;
    Draft: Draft;
    EmailSent: EmailSent;
    Follow: Follow;
    HasReacted: HasReacted;
    InviteCode: InviteCode;
    JobApplication: JobApplication;
    MailingListSubscription: MailingListSubscription;
    Meeting: Meeting;
    Notification: Notification;
    NotInterested: NotInterested;
    PaymentPromise: PaymentPromise;
    Post: Post;
    Reaction: Reaction;
    ReadSession: ReadSession;
    Record: Record;
    Reference: Reference;
    Timestamps: Timestamps;
    Topic: Topic;
    TopicCategory: TopicCategory;
    TopicInteraction: TopicInteraction;
    TopicToCategory: TopicToCategory;
    TopicVersion: TopicVersion;
    User: User;
    UserInterest: UserInterest;
    UserMonth: UserMonth;
    ValidationRequest: ValidationRequest;
    VoteReject: VoteReject;
};
