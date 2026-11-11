-- A block copied from another page gets a copy of its file (apps/web/src/lib/file-copy.ts).
ALTER TABLE "FileObject" ADD COLUMN "copiedFromId" TEXT;

CREATE UNIQUE INDEX "FileObject_pageId_copiedFromId_key" ON "FileObject"("pageId", "copiedFromId");
