-- AlterTable
ALTER TABLE "BrandSettings" ADD COLUMN     "favicon" BYTEA,
ADD COLUMN     "faviconType" TEXT,
ADD COLUMN     "faviconUpdatedAt" TIMESTAMP(3);
