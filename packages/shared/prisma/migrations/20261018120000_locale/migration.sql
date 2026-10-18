-- Display language: per user (null = the browser's) and the site default.
ALTER TABLE "User" ADD COLUMN "locale" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'ja';
