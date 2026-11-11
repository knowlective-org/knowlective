-- Files can be turned off site-wide (/admin/files).
ALTER TABLE "InstanceConfig" ADD COLUMN "uploadsEnabled" BOOLEAN NOT NULL DEFAULT true;
