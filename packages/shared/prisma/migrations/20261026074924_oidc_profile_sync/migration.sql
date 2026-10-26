-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "oidcCreated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "viaOidc" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OidcSettings" ADD COLUMN     "groupsClaim" TEXT,
ADD COLUMN     "syncName" BOOLEAN NOT NULL DEFAULT true;
