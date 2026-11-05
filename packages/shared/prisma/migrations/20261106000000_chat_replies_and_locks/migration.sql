-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "replyToId" TEXT;

-- CreateTable
CREATE TABLE "ChatLock" (
    "pageId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatLock_pkey" PRIMARY KEY ("pageId","blockId")
);

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatLock" ADD CONSTRAINT "ChatLock_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatLock" ADD CONSTRAINT "ChatLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
