-- AlterTable
ALTER TABLE "User" ADD COLUMN     "rootOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
