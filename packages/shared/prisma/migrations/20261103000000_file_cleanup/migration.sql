-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "unreferencedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PageFileRefs" (
    "pageId" TEXT NOT NULL,
    "fileIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageFileRefs_pkey" PRIMARY KEY ("pageId")
);

-- AddForeignKey
ALTER TABLE "PageFileRefs" ADD CONSTRAINT "PageFileRefs_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
