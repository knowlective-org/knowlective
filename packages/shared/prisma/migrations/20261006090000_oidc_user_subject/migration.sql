-- OpenID Connect: the IdP subject moves from the UserIdentity table onto User.

-- AlterTable
ALTER TABLE "OidcSettings" ADD COLUMN     "nameClaim" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "oidcIssuer" TEXT,
ADD COLUMN     "oidcSubject" TEXT;

-- Keep existing links (one per user: the earliest).
UPDATE "User" AS u
SET "oidcIssuer" = i."issuer", "oidcSubject" = i."subject"
FROM (
  SELECT DISTINCT ON ("userId") "userId", "issuer", "subject"
  FROM "UserIdentity"
  ORDER BY "userId", "createdAt"
) AS i
WHERE u."id" = i."userId";

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcIssuer_oidcSubject_key" ON "User"("oidcIssuer", "oidcSubject");

-- DropForeignKey
ALTER TABLE "UserIdentity" DROP CONSTRAINT "UserIdentity_userId_fkey";

-- DropTable
DROP TABLE "UserIdentity";
