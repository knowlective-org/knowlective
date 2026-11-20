-- CreateTable
CREATE TABLE "ReviewThread" (
    "pageId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "ReviewThread_pkey" PRIMARY KEY ("pageId","blockId")
);

-- AddForeignKey
ALTER TABLE "ReviewThread" ADD CONSTRAINT "ReviewThread_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewThread" ADD CONSTRAINT "ReviewThread_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

