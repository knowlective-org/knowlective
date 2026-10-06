-- CreateEnum
CREATE TYPE "PasswordLoginMode" AS ENUM ('ALLOWED', 'SITE_ADMINS_ONLY');

-- CreateTable
CREATE TABLE "OidcSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEnc" BYTEA NOT NULL,
    "buttonLabel" TEXT NOT NULL,
    "newUserRole" "SiteRole" NOT NULL DEFAULT 'USER',
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trustEmail" BOOLEAN NOT NULL DEFAULT false,
    "passwordLogin" "PasswordLoginMode" NOT NULL DEFAULT 'ALLOWED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_issuer_subject_key" ON "UserIdentity"("issuer", "subject");

-- AddForeignKey
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
