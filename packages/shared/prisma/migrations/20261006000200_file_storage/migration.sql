-- CreateTable
CREATE TABLE "StorageSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "endpoint" TEXT NOT NULL,
    "region" TEXT,
    "bucket" TEXT NOT NULL,
    "accessKeyId" TEXT NOT NULL,
    "secretAccessKeyEnc" BYTEA NOT NULL,
    "forcePathStyle" BOOLEAN NOT NULL DEFAULT false,
    "keyPrefix" TEXT NOT NULL DEFAULT '',
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageSettings_pkey" PRIMARY KEY ("id"),
    -- Singleton: only one storage configuration may exist.
    CONSTRAINT "StorageSettings_singleton" CHECK ("id" = 1)
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "rootId" TEXT NOT NULL,
    "pageId" TEXT,
    "uploadedById" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileObject_rootId_idx" ON "FileObject"("rootId");

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "KnowledgeRoot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

