import { prisma } from "@/lib/db";
import { deleteFileObject, getStorageConfig } from "@/lib/storage";

// Deletes attachments no page shows any more: the FileObject row and the
// stored object. Which files a page shows is PageFileRefs, kept by
// reindexPage() (every store of the collab server, restores and API writes go
// through it). Pages in the trash still count; versions don't, so an old
// version restored after the file is gone shows a broken file block.
//
// A file is deleted only after nothing has shown it for UNREFERENCED_GRACE_MS,
// so undo, cut and paste, or restoring the page from the trash within that
// time still find it. Uploads whose block was never saved go the same way.
export const UNREFERENCED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

const PASS_INTERVAL_MS = 60 * 60 * 1000;

// One pass. Returns how many files were deleted.
export async function cleanUpUnreferencedFiles(now = new Date()): Promise<number> {
  // A page with a body but no PageFileRefs yet (from before it existed: filled
  // in at server start by reindexStalePages()) might show any file.
  const unknown = await prisma.page.count({ where: { fileRefs: null, document: { isNot: null } } });
  if (unknown > 0) return 0;
  // Without storage the objects can't be deleted: leave the rows too.
  const config = await getStorageConfig();
  if (!config) return 0;

  await prisma.$executeRaw`
    UPDATE "FileObject" f SET "unreferencedAt" = NULL
    WHERE f."unreferencedAt" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "PageFileRefs" r WHERE f."id" = ANY (r."fileIds"))`;
  await prisma.$executeRaw`
    UPDATE "FileObject" f SET "unreferencedAt" = ${now}
    WHERE f."unreferencedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "PageFileRefs" r WHERE f."id" = ANY (r."fileIds"))`;
  // Checked again in the same statement: a page may have shown it since.
  const deleted = await prisma.$queryRaw<{ id: string }[]>`
    DELETE FROM "FileObject" f
    WHERE f."unreferencedAt" < ${new Date(now.getTime() - UNREFERENCED_GRACE_MS)}
      AND NOT EXISTS (SELECT 1 FROM "PageFileRefs" r WHERE f."id" = ANY (r."fileIds"))
    RETURNING f."id"`;

  // A failure leaves an unreadable (encrypted, unreferenced) object behind.
  for (const { id } of deleted) {
    await deleteFileObject(config, id).catch((err) => console.error("[files] deleting a stored file failed", err));
  }
  if (deleted.length > 0) console.log(`[files] deleted ${deleted.length} attachment(s) no page has shown for 30 days`);
  return deleted.length;
}

// The hourly pass (once per server).
export function startFileCleanup(): void {
  const flag = Symbol.for("knowlective.file-cleanup");
  const g = globalThis as Record<symbol, unknown>;
  if (g[flag]) return;
  g[flag] = true;
  const pass = async () => {
    try {
      await cleanUpUnreferencedFiles();
    } catch (err) {
      console.error("[files] the cleanup pass failed", err);
    } finally {
      setTimeout(pass, PASS_INTERVAL_MS).unref();
    }
  };
  // After the start-up reindexing has had time to fill in PageFileRefs.
  setTimeout(pass, 5 * 60_000).unref();
}
