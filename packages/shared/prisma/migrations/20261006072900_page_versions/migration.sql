-- CreateEnum
CREATE TYPE "PageVersionKind" AS ENUM ('AUTO', 'INITIAL', 'BEFORE_RESTORE', 'RESTORED');

-- CreateTable
CREATE TABLE "PageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "PageVersionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "editorIds" TEXT[],
    "state" BYTEA NOT NULL,
    "restoredFromId" TEXT,

    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageVersion_pageId_createdAt_idx" ON "PageVersion"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
