-- The order of the knowledge roots shown to visitors who aren't logged in.
ALTER TABLE "InstanceConfig" ADD COLUMN "publicRootOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
