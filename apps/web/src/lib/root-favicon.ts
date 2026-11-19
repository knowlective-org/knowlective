import { decrypt, encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { getPageAccess } from "@/lib/page-access";
import type { FaviconType } from "@/lib/favicon-check";

// A knowledge root's favicon (KnowledgeRoot.favicon*): shown in the tab on
// its pages (components/root-favicon.tsx) and by its name in the sidebar,
// only to those who can open its root page (as its name is: someone who sees
// a page shared without its root sees neither). Set from the root page's
// menu by those who can manage it ((app)/pages/[pageId]/favicon-actions.ts);
// the check of the upload is lib/favicon-check.ts.

const aad = (rootId: string) => `knowlective:root-favicon:${rootId}`;

export async function sealFavicon(rootId: string, bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(bytes), aad(rootId)));
}

export async function openFavicon(rootId: string, sealed: Uint8Array): Promise<Buffer> {
  return decrypt(await loadDataKey(prisma), sealed, aad(rootId));
}

// The favicon's address; the time it was set makes a new one for a new image.
export const rootFaviconUrl = (rootId: string, updatedAt: Date) => `/api/roots/${rootId}/favicon?v=${updatedAt.getTime()}`;

// The favicons of these roots (those that have one), by root.
export async function rootFaviconUrls(rootIds: string[]): Promise<Map<string, string>> {
  if (rootIds.length === 0) return new Map();
  const rows = await prisma.knowledgeRoot.findMany({
    where: { id: { in: rootIds }, faviconUpdatedAt: { not: null } },
    select: { id: true, faviconUpdatedAt: true },
  });
  return new Map(rows.map((r) => [r.id, rootFaviconUrl(r.id, r.faviconUpdatedAt!)]));
}

// The favicon of the root a page is in, for this viewer: only when they can
// open the root page.
export async function faviconForViewer(userId: string | null, rootId: string): Promise<string | null> {
  const root = await prisma.knowledgeRoot.findUnique({
    where: { id: rootId },
    select: { rootPageId: true, faviconUpdatedAt: true },
  });
  if (!root?.rootPageId || !root.faviconUpdatedAt) return null;
  if (!(await getPageAccess(prisma, userId, root.rootPageId))) return null;
  return rootFaviconUrl(rootId, root.faviconUpdatedAt);
}

// The favicon itself, for this viewer (null: none, or not theirs to see).
export async function readRootFavicon(
  userId: string | null,
  rootId: string,
): Promise<{ type: FaviconType; bytes: Buffer } | null> {
  const root = await prisma.knowledgeRoot.findUnique({
    where: { id: rootId },
    select: { rootPageId: true, faviconEnc: true, faviconType: true },
  });
  if (!root?.rootPageId || !root.faviconEnc || !root.faviconType) return null;
  if (!(await getPageAccess(prisma, userId, root.rootPageId))) return null;
  return { type: root.faviconType as FaviconType, bytes: await openFavicon(rootId, root.faviconEnc) };
}

// The image of a public page's link card (Open Graph / Twitter card), for
// someone not logged in: the root's favicon when they can see it and it's a
// PNG (X and most link cards read neither SVG nor ICO), else the app icon.
// A path under the site (prefix it with getPublicUrl()).
export const APP_CARD_ICON = "/icons/icon-512.png";
export async function cardImageForGuest(rootId: string): Promise<string> {
  const root = await prisma.knowledgeRoot.findUnique({
    where: { id: rootId },
    select: { rootPageId: true, faviconType: true, faviconUpdatedAt: true },
  });
  if (!root?.rootPageId || !root.faviconUpdatedAt || root.faviconType !== "image/png") return APP_CARD_ICON;
  if (!(await getPageAccess(prisma, null, root.rootPageId))) return APP_CARD_ICON;
  return rootFaviconUrl(rootId, root.faviconUpdatedAt);
}
