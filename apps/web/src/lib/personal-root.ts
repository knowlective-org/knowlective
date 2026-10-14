import { prisma } from "@/lib/db";
import { closeDocuments } from "@/lib/collab-events";
import { deleteFileObject, getStorageConfig } from "@/lib/storage";

// Removes a user's personal knowledge root for good: every page in it (the
// trash included), their documents, versions, search index, child-table
// values and attachments — stored files too. For when the account itself is
// deleted: nobody else could ever open these pages, so nothing would be left
// to anyone. (Disabling an account leaves the root alone.)
//
// Accounts can't be deleted yet; whatever deletes one must call this first,
// in the same flow.
export async function deletePersonalRoot(userId: string): Promise<boolean> {
  const root = await prisma.knowledgeRoot.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (!root) return false;
  const [pages, files] = await Promise.all([
    prisma.page.findMany({ where: { rootId: root.id }, select: { id: true } }),
    prisma.fileObject.findMany({ where: { rootId: root.id }, select: { id: true } }),
  ]);
  const pageIds = pages.map((p) => p.id);
  // Open editors are closed first, so nothing is saved back afterwards.
  closeDocuments(pageIds);

  await prisma.$transaction(async (tx) => {
    // Tables that don't go with their page by themselves.
    await tx.pageDocument.deleteMany({ where: { pageId: { in: pageIds } } });
    await tx.pageSearchIndex.deleteMany({ where: { pageId: { in: pageIds } } });
    await tx.fileObject.deleteMany({ where: { rootId: root.id } });
    // The root points at its root page (and won't let it go): unlink first.
    await tx.knowledgeRoot.update({ where: { id: root.id }, data: { rootPageId: null } });
    // Versions, grants and child-table columns and values go with the pages.
    await tx.page.deleteMany({ where: { rootId: root.id } });
    await tx.knowledgeRoot.delete({ where: { id: root.id } });
  });

  // The stored files, once nothing refers to them. A failure leaves an
  // unreadable (encrypted, unreferenced) object behind, not an error.
  const config = await getStorageConfig();
  if (config) {
    for (const file of files) {
      await deleteFileObject(config, file.id).catch((err) => console.error("[accounts] deleting a stored file failed", err));
    }
  }
  return true;
}