-- The public page "/" shows someone not logged in (instead of the login screen).
ALTER TABLE "InstanceConfig" ADD COLUMN "landingPageId" TEXT;
