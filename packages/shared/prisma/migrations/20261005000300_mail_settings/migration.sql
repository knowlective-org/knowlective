-- CreateEnum
CREATE TYPE "SmtpSecurity" AS ENUM ('NONE', 'STARTTLS', 'TLS');

-- CreateTable
CREATE TABLE "MailSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "security" "SmtpSecurity" NOT NULL,
    "authEnabled" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT,
    "passwordEnc" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSettings_pkey" PRIMARY KEY ("id"),
    -- Singleton: only one mail configuration may exist.
    CONSTRAINT "MailSettings_singleton" CHECK ("id" = 1)
);

