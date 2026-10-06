-- Site-wide roles replace the built-in "site admins" group. Groups are now
-- only for page tree permissions.

-- CreateEnum
CREATE TYPE "SiteRole" AS ENUM ('SITE_ADMIN', 'CONTENT_MANAGER', 'USER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "siteRole" "SiteRole" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "siteRole" "SiteRole" NOT NULL DEFAULT 'USER';

-- Members of the built-in site admins group become SITE_ADMIN, then the
-- group (and its memberships) is removed.
UPDATE "User" SET "siteRole" = 'SITE_ADMIN'
WHERE "id" IN (
  SELECT gm."userId" FROM "GroupMember" gm
  JOIN "Group" g ON g."id" = gm."groupId"
  WHERE g."systemKey" = 'site_admins'
);
DELETE FROM "Group" WHERE "systemKey" IS NOT NULL;

-- DropIndex
DROP INDEX "Group_systemKey_key";

-- AlterTable
ALTER TABLE "Group" DROP COLUMN "systemKey";
