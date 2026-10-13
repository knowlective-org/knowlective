-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "uploadAllowedExtensions" TEXT[] DEFAULT ARRAY[]::TEXT[];
