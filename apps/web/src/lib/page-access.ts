import { headers } from "next/headers";
import * as permissions from "shared";
import type { PageAccess, PrismaClient } from "shared";
import { prisma as appPrisma } from "@/lib/db";
import { getClientIp } from "@/lib/ip";
import { FULL_CAPS, type NetworkCaps, capsFor, getNetworkSettings } from "@/lib/network-policy";

// Page permissions as the app checks them: shared's permission functions,
// capped by the network the request comes from (lib/network-policy.ts).
// Same names and signatures as in shared, so the app imports them from here
// (never straight from "shared"):
// - reading not allowed: no page is visible (as if no permission);
// - changing not allowed: every permission is VIEW at most, so nothing that
//   checks EDIT or MANAGE (editing, creating, moving, deleting, locking,
//   sharing, restoring, the API's writes) goes through.
// The collab server applies the same caps on its own (server/collab.ts).

// The current request's caps. Outside a request (background work): full.
export async function requestNetworkCaps(): Promise<NetworkCaps> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    return FULL_CAPS;
  }
  return capsFor(getClientIp(h), await getNetworkSettings(appPrisma));
}

const capped = (access: PageAccess, caps: NetworkCaps): PageAccess => (caps.write ? access : "VIEW");

export async function getPageAccess(prisma: PrismaClient, userId: string | null, pageId: string) {
  const caps = await requestNetworkCaps();
  if (!caps.read) return null;
  const result = await permissions.getPageAccess(prisma, userId, pageId);
  return result && { ...result, access: capped(result.access, caps) };
}

export async function getVisibleTrees(prisma: PrismaClient, userId: string | null) {
  const caps = await requestNetworkCaps();
  if (!caps.read) return [];
  const trees = await permissions.getVisibleTrees(prisma, userId);
  return caps.write ? trees : trees.map((t) => ({ ...t, pages: t.pages.map((p) => ({ ...p, access: capped(p.access, caps) })) }));
}

export async function getVisibleTree(prisma: PrismaClient, userId: string | null, rootId: string) {
  const caps = await requestNetworkCaps();
  if (!caps.read) return null;
  const tree = await permissions.getVisibleTree(prisma, userId, rootId);
  return tree && (caps.write ? tree : { ...tree, pages: tree.pages.map((p) => ({ ...p, access: capped(p.access, caps) })) });
}

export async function getTreeWithAccess(prisma: PrismaClient, userId: string, rootId: string) {
  const caps = await requestNetworkCaps();
  const tree = await permissions.getTreeWithAccess(prisma, userId, rootId);
  if (caps.write) return tree;
  const access = new Map<string, PageAccess>();
  if (caps.read) for (const [id, a] of tree.access) access.set(id, capped(a, caps));
  return { ...tree, access };
}

export async function getTrash(prisma: PrismaClient, userId: string) {
  const caps = await requestNetworkCaps();
  if (!caps.read) return { items: [], destinations: {} };
  const trash = await permissions.getTrash(prisma, userId);
  // Restoring is a change.
  return caps.write ? trash : { ...trash, destinations: {} };
}
