-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('CHAT_MESSAGE', 'TODO_ASSIGNED', 'TODO_OVERDUE', 'PAGE_CHANGED', 'MENTION');

-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "pushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPrefs" JSONB;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "pageId" TEXT NOT NULL,
    "actorId" TEXT,
    "excerptEnc" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageFollow" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "PageFollow_pkey" PRIMARY KEY ("userId","pageId")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "dataEnc" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushKeys" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "publicKey" TEXT NOT NULL,
    "privateKeyEnc" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushKeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageTodoItem" (
    "pageId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "due" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "overdueNotified" TEXT,

    CONSTRAINT "PageTodoItem_pkey" PRIMARY KEY ("pageId","blockId")
);

-- CreateTable
CREATE TABLE "PageMention" (
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PageMention_pkey" PRIMARY KEY ("pageId","userId")
);

-- CreateTable
CREATE TABLE "PageNotifyIndex" (
    "pageId" TEXT NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageNotifyIndex_pkey" PRIMARY KEY ("pageId")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_pageId_readAt_idx" ON "Notification"("userId", "pageId", "readAt");

-- CreateIndex
CREATE INDEX "PageFollow_pageId_idx" ON "PageFollow"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PageTodoItem_due_idx" ON "PageTodoItem"("due");

-- CreateIndex
CREATE INDEX "PageMention_userId_idx" ON "PageMention"("userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageFollow" ADD CONSTRAINT "PageFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageFollow" ADD CONSTRAINT "PageFollow_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageTodoItem" ADD CONSTRAINT "PageTodoItem_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageMention" ADD CONSTRAINT "PageMention_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageNotifyIndex" ADD CONSTRAINT "PageNotifyIndex_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
