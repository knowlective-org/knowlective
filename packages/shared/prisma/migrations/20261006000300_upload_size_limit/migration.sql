-- The upload size limit is now independent of the storage settings, so it can
-- be changed while using the bundled storage too.

-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "maxUploadSizeMb" INTEGER NOT NULL DEFAULT 100;

-- Keep a limit that was already configured with custom storage.
UPDATE "InstanceConfig" SET "maxUploadSizeMb" = s."maxFileSizeMb"
FROM "StorageSettings" s WHERE s."id" = 1;

-- AlterTable
ALTER TABLE "StorageSettings" DROP COLUMN "maxFileSizeMb";
