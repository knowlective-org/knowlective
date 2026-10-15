-- Email addresses and audit log text move to encrypted columns. The DEK is
-- needed to fill them, so the plaintext is kept in legacy* columns here and
-- the server converts the rows at startup (encryptLegacyPersonalData).

-- User
DROP INDEX "User_email_key";
ALTER TABLE "User" RENAME COLUMN "email" TO "legacyEmail";
ALTER TABLE "User" ALTER COLUMN "legacyEmail" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "emailHash" BYTEA, ADD COLUMN "emailEnc" BYTEA;
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

-- AdminLoginAttempt
ALTER TABLE "AdminLoginAttempt" RENAME COLUMN "email" TO "legacyEmail";
ALTER TABLE "AdminLoginAttempt" ADD COLUMN "emailHash" BYTEA, ADD COLUMN "emailEnc" BYTEA;

-- Invitation
ALTER TABLE "Invitation" RENAME COLUMN "email" TO "legacyEmail";
ALTER TABLE "Invitation" ADD COLUMN "emailHash" BYTEA, ADD COLUMN "emailEnc" BYTEA;

-- UserLoginAttempt
DROP INDEX "UserLoginAttempt_email_createdAt_idx";
ALTER TABLE "UserLoginAttempt" RENAME COLUMN "email" TO "legacyEmail";
ALTER TABLE "UserLoginAttempt" ALTER COLUMN "legacyEmail" DROP NOT NULL;
ALTER TABLE "UserLoginAttempt" ADD COLUMN "emailHash" BYTEA;
CREATE INDEX "UserLoginAttempt_emailHash_createdAt_idx" ON "UserLoginAttempt"("emailHash", "createdAt");

-- AuditLog
ALTER TABLE "AuditLog" RENAME COLUMN "actorLabel" TO "legacyActorLabel";
ALTER TABLE "AuditLog" ALTER COLUMN "legacyActorLabel" DROP NOT NULL;
ALTER TABLE "AuditLog" RENAME COLUMN "summary" TO "legacySummary";
ALTER TABLE "AuditLog" ALTER COLUMN "legacySummary" DROP NOT NULL;
ALTER TABLE "AuditLog" RENAME COLUMN "detail" TO "legacyDetail";
ALTER TABLE "AuditLog" ADD COLUMN "sealed" BYTEA;
