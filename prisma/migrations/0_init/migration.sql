-- CreateEnum
CREATE TYPE "MirrorStatus" AS ENUM ('Dirty', 'InProcess', 'Sync', 'Failed');

-- CreateEnum
CREATE TYPE "PromiseStatus" AS ENUM ('Pending', 'Confirmed', 'Canceled');

-- CreateEnum
CREATE TYPE "ReferenceType" AS ENUM ('Strong', 'Weak');

-- CreateEnum
CREATE TYPE "EditorStatus" AS ENUM ('Beginner', 'Editor', 'Administrator');

-- CreateTable
CREATE TABLE "AuthSession" (
    "key" TEXT NOT NULL,
    "session" TEXT NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuthState" (
    "key" TEXT NOT NULL,
    "state" TEXT NOT NULL,

    CONSTRAINT "AuthState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "User" (
    "did" VARCHAR(255) NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "avatar" TEXT,
    "banner" TEXT,
    "email" TEXT,
    "description" TEXT,
    "hasAccess" BOOLEAN NOT NULL DEFAULT false,
    "inCA" BOOLEAN NOT NULL DEFAULT false,
    "CAProfileUri" TEXT,
    "mirrorStatus" "MirrorStatus" NOT NULL DEFAULT 'Dirty',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editorStatus" "EditorStatus" NOT NULL DEFAULT 'Beginner',
    "platformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "seenTutorial" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("did")
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "code" TEXT NOT NULL,
    "usedByDid" TEXT,
    "usedAt" TIMESTAMP(3),
    "recommenderId" TEXT,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boughtByUserId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "price" INTEGER NOT NULL,
    "paymentId" TEXT,
    "endsAt" TIMESTAMP(3),
    "promisesCreated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPromise" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "contentUri" TEXT NOT NULL,
    "status" "PromiseStatus" NOT NULL DEFAULT 'Pending',

    CONSTRAINT "PaymentPromise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "protection" "EditorStatus" NOT NULL DEFAULT 'Beginner',
    "currentVersionId" TEXT,
    "synonyms" TEXT[],
    "lastSynonymsChange" TIMESTAMP(3),
    "popularityScore" INTEGER,
    "lastEdit" TIMESTAMP(3),

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicCategory" (
    "id" TEXT NOT NULL,

    CONSTRAINT "TopicCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryLink" (
    "idCategoryA" TEXT NOT NULL,
    "idCategoryB" TEXT NOT NULL,

    CONSTRAINT "CategoryLink_pkey" PRIMARY KEY ("idCategoryA","idCategoryB")
);

-- CreateTable
CREATE TABLE "TopicToCategory" (
    "topicId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "TopicToCategory_pkey" PRIMARY KEY ("topicId","categoryId")
);

-- CreateTable
CREATE TABLE "Record" (
    "uri" TEXT NOT NULL,
    "cid" TEXT,
    "collection" TEXT NOT NULL,
    "rkey" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "record" TEXT,
    "uniqueViewsCount" INTEGER DEFAULT 0,
    "lastInThreadId" TEXT,
    "secondToLastInThreadId" TEXT,
    "enDiscusion" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Record_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Content" (
    "uri" TEXT NOT NULL,
    "text" TEXT,
    "textBlobId" TEXT,
    "format" TEXT NOT NULL DEFAULT 'lexical-compressed',
    "numWords" INTEGER,
    "lastReferencesUpdate" TIMESTAMP(3),

    CONSTRAINT "Content_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Post" (
    "uri" TEXT NOT NULL,
    "facets" TEXT,
    "embed" TEXT,
    "replyToId" TEXT,
    "quote" TEXT,
    "rootId" TEXT,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Follow" (
    "uri" TEXT NOT NULL,
    "userFollowedId" TEXT,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Like" (
    "uri" TEXT NOT NULL,
    "likedRecordId" TEXT,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Repost" (
    "uri" TEXT NOT NULL,
    "repostedRecordId" TEXT,

    CONSTRAINT "Repost_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "TopicAccept" (
    "uri" TEXT NOT NULL,
    "acceptedRecordId" TEXT,

    CONSTRAINT "TopicAccept_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "TopicReject" (
    "uri" TEXT NOT NULL,
    "rejectedRecordId" TEXT,

    CONSTRAINT "TopicReject_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "TopicVersion" (
    "uri" TEXT NOT NULL,
    "title" TEXT,
    "topicId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "synonyms" TEXT,
    "categories" TEXT,
    "authorship" BOOLEAN NOT NULL DEFAULT true,
    "charsAdded" INTEGER,
    "charsDeleted" INTEGER,
    "accCharsAdded" INTEGER,
    "contribution" TEXT,
    "diff" TEXT,

    CONSTRAINT "TopicVersion_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Article" (
    "uri" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "uri" TEXT NOT NULL,
    "columns" TEXT[],
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Blob" (
    "cid" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "Blob_pkey" PRIMARY KEY ("cid")
);

-- CreateTable
CREATE TABLE "DataBlock" (
    "uri" TEXT NOT NULL,
    "datasetId" TEXT,
    "format" TEXT NOT NULL,
    "blobId" TEXT,

    CONSTRAINT "DataBlock_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userById" TEXT NOT NULL,
    "recordId" TEXT,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visualization" (
    "uri" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "datasetId" TEXT,
    "previewBlobCid" TEXT,

    CONSTRAINT "Visualization_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "type" "ReferenceType" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "referencedTopicId" TEXT NOT NULL,
    "referencingContentId" TEXT NOT NULL,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "seen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_CAProfileUri_key" ON "User"("CAProfileUri");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_usedByDid_key" ON "InviteCode"("usedByDid");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_recommenderId_key" ON "InviteCode"("recommenderId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_currentVersionId_key" ON "Topic"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Record_uri_key" ON "Record"("uri");

-- CreateIndex
CREATE UNIQUE INDEX "Record_lastInThreadId_key" ON "Record"("lastInThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "Record_secondToLastInThreadId_key" ON "Record"("secondToLastInThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "Blob_cid_key" ON "Blob"("cid");

-- CreateIndex
CREATE UNIQUE INDEX "DataBlock_blobId_key" ON "DataBlock"("blobId");

-- CreateIndex
CREATE UNIQUE INDEX "Reference_referencingContentId_referencedTopicId_key" ON "Reference"("referencingContentId", "referencedTopicId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_CAProfileUri_fkey" FOREIGN KEY ("CAProfileUri") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_usedByDid_fkey" FOREIGN KEY ("usedByDid") REFERENCES "User"("did") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_recommenderId_fkey" FOREIGN KEY ("recommenderId") REFERENCES "User"("did") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_boughtByUserId_fkey" FOREIGN KEY ("boughtByUserId") REFERENCES "User"("did") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("did") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPromise" ADD CONSTRAINT "PaymentPromise_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("did") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPromise" ADD CONSTRAINT "PaymentPromise_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "TopicVersion"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryLink" ADD CONSTRAINT "CategoryLink_idCategoryA_fkey" FOREIGN KEY ("idCategoryA") REFERENCES "TopicCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryLink" ADD CONSTRAINT "CategoryLink_idCategoryB_fkey" FOREIGN KEY ("idCategoryB") REFERENCES "TopicCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicToCategory" ADD CONSTRAINT "TopicToCategory_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicToCategory" ADD CONSTRAINT "TopicToCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TopicCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("did") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_lastInThreadId_fkey" FOREIGN KEY ("lastInThreadId") REFERENCES "Post"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_secondToLastInThreadId_fkey" FOREIGN KEY ("secondToLastInThreadId") REFERENCES "Post"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_textBlobId_fkey" FOREIGN KEY ("textBlobId") REFERENCES "Blob"("cid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Content"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_userFollowedId_fkey" FOREIGN KEY ("userFollowedId") REFERENCES "User"("did") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_likedRecordId_fkey" FOREIGN KEY ("likedRecordId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repost" ADD CONSTRAINT "Repost_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repost" ADD CONSTRAINT "Repost_repostedRecordId_fkey" FOREIGN KEY ("repostedRecordId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicAccept" ADD CONSTRAINT "TopicAccept_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicAccept" ADD CONSTRAINT "TopicAccept_acceptedRecordId_fkey" FOREIGN KEY ("acceptedRecordId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicReject" ADD CONSTRAINT "TopicReject_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicReject" ADD CONSTRAINT "TopicReject_rejectedRecordId_fkey" FOREIGN KEY ("rejectedRecordId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicVersion" ADD CONSTRAINT "TopicVersion_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Content"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicVersion" ADD CONSTRAINT "TopicVersion_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Content"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blob" ADD CONSTRAINT "Blob_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("did") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBlock" ADD CONSTRAINT "DataBlock_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBlock" ADD CONSTRAINT "DataBlock_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBlock" ADD CONSTRAINT "DataBlock_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "Blob"("cid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_userById_fkey" FOREIGN KEY ("userById") REFERENCES "User"("did") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visualization" ADD CONSTRAINT "Visualization_uri_fkey" FOREIGN KEY ("uri") REFERENCES "Record"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visualization" ADD CONSTRAINT "Visualization_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Record"("uri") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visualization" ADD CONSTRAINT "Visualization_previewBlobCid_fkey" FOREIGN KEY ("previewBlobCid") REFERENCES "Blob"("cid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_referencedTopicId_fkey" FOREIGN KEY ("referencedTopicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_referencingContentId_fkey" FOREIGN KEY ("referencingContentId") REFERENCES "Content"("uri") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("did") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("did") ON DELETE RESTRICT ON UPDATE CASCADE;

