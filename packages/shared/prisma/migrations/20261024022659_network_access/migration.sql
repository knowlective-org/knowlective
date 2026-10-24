-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "networkFullAccess" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "networkOtherAccess" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "networkOtherDownload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "networkOtherRead" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "networkOtherUpload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "networkOtherWrite" BOOLEAN NOT NULL DEFAULT false;
