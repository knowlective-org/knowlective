"use server";

import { revalidatePath } from "next/cache";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { requireAdmin } from "@/lib/admin/auth";
import { recordAudit } from "@/lib/audit";
import { closeDocuments } from "@/lib/collab-events";
import { prisma } from "@/lib/db";

// Deleting a knowledge root (site admins): nobody can open any of its pages
// any more (permissions.ts gives a deleted root no grants), but nothing is
// removed, and it can be restored. Not personal roots.

async function sharedRoot(formData: FormData) {
  const rootId = formData.get("rootId");
  if (typeof rootId !== "string" || !rootId) return null;
  const root = await prisma.knowledgeRoot.findUnique({
    where: { id: rootId },
    select: { id: true, ownerId: true, deletedAt: true, rootPageId: true, rootPage: { select: { title: true } } },
  });
  return root && !root.ownerId ? root : null;
}

export async function deleteKnowledgeRoot(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const root = await sharedRoot(formData);
  if (!root || root.deletedAt) return;
  const done = await prisma.knowledgeRoot.updateMany({
    where: { id: root.id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: actor.userId },
  });
  if (done.count === 0) return;
  const audit = await auditTranslator();
  await recordAudit(actor, "root.delete", audit("audit.rootDelete", { title: displayTitleWith(audit)(root.rootPage?.title ?? "") }), {
    rootId: root.id,
    rootPageId: root.rootPageId,
  });
  // Open pages of it are told and closed (as when a page is deleted).
  const pages = await prisma.page.findMany({ where: { rootId: root.id }, select: { id: true } });
  closeDocuments(pages.map((p) => p.id));
  revalidatePath("/admin", "layout");
}

export async function restoreKnowledgeRoot(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const root = await sharedRoot(formData);
  if (!root?.deletedAt) return;
  const done = await prisma.knowledgeRoot.updateMany({
    where: { id: root.id, deletedAt: { not: null } },
    data: { deletedAt: null, deletedById: null },
  });
  if (done.count === 0) return;
  const audit = await auditTranslator();
  await recordAudit(actor, "root.restore", audit("audit.rootRestore", { title: displayTitleWith(audit)(root.rootPage?.title ?? "") }), {
    rootId: root.id,
    rootPageId: root.rootPageId,
  });
  revalidatePath("/admin", "layout");
}
