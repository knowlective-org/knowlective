"use server";

import { getTranslations } from "next-intl/server";
import { atLeast } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getPageAccess } from "@/lib/page-access";
import { checkFavicon } from "@/lib/favicon-check";
import { rootFaviconUrl, sealFavicon } from "@/lib/root-favicon";

// A knowledge root's favicon (lib/root-favicon.ts), set or removed from its
// root page's menu by those who can manage the root page.

// The root whose root page this is, if the user may manage it.
async function managedRoot(userId: string, pageId: unknown): Promise<string | null> {
  if (typeof pageId !== "string") return null;
  const root = await prisma.knowledgeRoot.findUnique({ where: { rootPageId: pageId }, select: { id: true } });
  if (!root) return null;
  const access = await getPageAccess(prisma, userId, pageId);
  return access && atLeast(access.access, "MANAGE") ? root.id : null;
}

// The current favicon's address (null: none), for the dialog.
export async function loadRootFavicon(pageId: string): Promise<{ url: string | null } | null> {
  const user = await requireUser();
  const rootId = await managedRoot(user.id, pageId);
  if (!rootId) return null;
  const root = await prisma.knowledgeRoot.findUnique({ where: { id: rootId }, select: { faviconUpdatedAt: true } });
  return { url: root?.faviconUpdatedAt ? rootFaviconUrl(rootId, root.faviconUpdatedAt) : null };
}

export async function setRootFavicon(pageId: string, form: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("rootFavicon");
  const rootId = await managedRoot(user.id, pageId);
  if (!rootId) return { error: t("cannot") };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: t("noFile") };
  if (file.size > 1024 * 1024) return { error: t("tooLarge") };
  const checked = checkFavicon(new Uint8Array(await file.arrayBuffer()));
  if ("error" in checked) return { error: t(checked.error) };
  await prisma.knowledgeRoot.update({
    where: { id: rootId },
    data: { faviconEnc: await sealFavicon(rootId, checked.bytes), faviconType: checked.type, faviconUpdatedAt: new Date() },
  });
  return {};
}

export async function removeRootFavicon(pageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("rootFavicon");
  const rootId = await managedRoot(user.id, pageId);
  if (!rootId) return { error: t("cannot") };
  await prisma.knowledgeRoot.update({
    where: { id: rootId },
    data: { faviconEnc: null, faviconType: null, faviconUpdatedAt: null },
  });
  return {};
}
