-- CreateEnum
CREATE TYPE "LoginMethod" AS ENUM ('PASSWORD', 'PASSKEY', 'OIDC');

-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "passkeyRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserSession" ADD COLUMN     "method" "LoginMethod";

-- CreateTable
CREATE TABLE "UserPasskey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nameEnc" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "UserPasskey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPasskey_credentialId_key" ON "UserPasskey"("credentialId");

-- CreateIndex
CREATE INDEX "UserPasskey_userId_idx" ON "UserPasskey"("userId");

-- AddForeignKey
ALTER TABLE "UserPasskey" ADD CONSTRAINT "UserPasskey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
