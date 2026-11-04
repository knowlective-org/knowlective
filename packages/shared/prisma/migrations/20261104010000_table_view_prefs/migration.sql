-- CreateTable
CREATE TABLE "TableViewPref" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "viewEnc" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableViewPref_pkey" PRIMARY KEY ("userId","pageId","blockId")
);

-- CreateIndex
CREATE INDEX "TableViewPref_pageId_idx" ON "TableViewPref"("pageId");

-- AddForeignKey
ALTER TABLE "TableViewPref" ADD CONSTRAINT "TableViewPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableViewPref" ADD CONSTRAINT "TableViewPref_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
