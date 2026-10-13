-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "linkPreviewAllowPrivate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkPreviewEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "linkPreviewProxyPasswordEnc" BYTEA,
ADD COLUMN     "linkPreviewProxyUrl" TEXT,
ADD COLUMN     "linkPreviewProxyUsername" TEXT;
