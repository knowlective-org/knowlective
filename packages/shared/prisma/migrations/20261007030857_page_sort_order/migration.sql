-- DropIndex
DROP INDEX "Page_parentId_idx";

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Page_parentId_sortOrder_idx" ON "Page"("parentId", "sortOrder");

-- Existing pages keep their current order (creation order) among siblings.
UPDATE "Page" AS p
SET "sortOrder" = s.rn
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "parentId" ORDER BY "createdAt", "id") - 1)::INTEGER AS rn
  FROM "Page"
) AS s
WHERE p."id" = s."id";
