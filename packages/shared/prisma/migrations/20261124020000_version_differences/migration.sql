-- Page versions can be a difference from an earlier version (baseId).
-- Existing rows stay whole versions: no data is rewritten.
ALTER TABLE "PageVersion" ADD COLUMN "baseId" TEXT;
ALTER TABLE "PageVersion" ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0;
