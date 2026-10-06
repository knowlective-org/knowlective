-- CreateTable
CREATE TABLE "PageSearchIndex" (
    "pageId" TEXT NOT NULL,
    "tokens" BIGINT[],
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSearchIndex_pkey" PRIMARY KEY ("pageId")
);

-- CreateIndex
CREATE INDEX "PageSearchIndex_tokens_idx" ON "PageSearchIndex" USING GIN ("tokens");

-- AddForeignKey
ALTER TABLE "PageSearchIndex" ADD CONSTRAINT "PageSearchIndex_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
