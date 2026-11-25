-- How long page history is kept (null: forever), and the last cleanup pass.
ALTER TABLE "InstanceConfig" ADD COLUMN "versionRetentionDays" INTEGER;
ALTER TABLE "InstanceConfig" ADD COLUMN "versionCleanupAt" TIMESTAMP(3);
ALTER TABLE "InstanceConfig" ADD COLUMN "versionCleanupDeleted" INTEGER;
