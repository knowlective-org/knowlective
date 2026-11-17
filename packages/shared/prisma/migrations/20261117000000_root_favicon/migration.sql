-- A knowledge root's favicon (encrypted image, its type, when it was set).
ALTER TABLE "KnowledgeRoot" ADD COLUMN "faviconEnc" BYTEA,
ADD COLUMN "faviconType" TEXT,
ADD COLUMN "faviconUpdatedAt" TIMESTAMP(3);
