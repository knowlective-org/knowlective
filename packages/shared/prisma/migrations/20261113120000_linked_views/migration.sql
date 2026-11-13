-- CreateTable
CREATE TABLE "PageLinkedView" (
    "pageId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "PageLinkedView_pkey" PRIMARY KEY ("pageId","sourceId")
);

-- CreateIndex
CREATE INDEX "PageLinkedView_sourceId_idx" ON "PageLinkedView"("sourceId");

-- AddForeignKey
ALTER TABLE "PageLinkedView" ADD CONSTRAINT "PageLinkedView_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
