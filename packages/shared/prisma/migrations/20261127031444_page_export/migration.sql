-- CreateTable
CREATE TABLE "PageExport" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "PageExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageExport_tokenHash_key" ON "PageExport"("tokenHash");

-- CreateIndex
CREATE INDEX "PageExport_userId_idx" ON "PageExport"("userId");

-- CreateIndex
CREATE INDEX "PageExport_expiresAt_idx" ON "PageExport"("expiresAt");

-- AddForeignKey
ALTER TABLE "PageExport" ADD CONSTRAINT "PageExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
