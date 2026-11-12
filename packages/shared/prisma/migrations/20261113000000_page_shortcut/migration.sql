-- Shortcuts: a page of the kind SHORTCUT that opens another page.
ALTER TYPE "PageKind" ADD VALUE 'SHORTCUT';
ALTER TABLE "Page" ADD COLUMN "shortcutTargetId" TEXT;
CREATE INDEX "Page_shortcutTargetId_idx" ON "Page"("shortcutTargetId");
