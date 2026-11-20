-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarEnc" BYTEA,
ADD COLUMN     "avatarType" TEXT,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3);
