"use server";

import { atLeast, decrypt, getPageAccess, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { restoreVersion } from "@/lib/collab-events";
import { versionAad } from "@/lib/page-versions";

// 履歴表示. Viewing needs access to the page (VIEW); restoring needs EDIT.
// A version id that doesn't belong to the page is treated as missing.

async function findVersion(pageId: unknown, versionId: unknown) {
  if (typeof pageId !== "string" || typeof versionId !== "string") return null;
  const version = await prisma.pageVersion.findUnique({ where: { id: versionId } });
  return version && version.pageId === pageId ? version : null;
}

// The version's Yjs state (base64), for the read-only preview.
export async function loadVersion(pageId: string, versionId: string): Promise<{ title: string; state: string } | null> {
  const user = await requireUser();
  if (typeof pageId !== "string" || !(await getPageAccess(prisma, user.id, pageId))) return null;
  const version = await findVersion(pageId, versionId);
  if (!version) return null;
  const state = decrypt(await loadDataKey(prisma), version.state, versionAad(pageId, version.id));
  return { title: version.title, state: Buffer.from(state).toString("base64") };
}

export async function restorePageVersion(pageId: string, versionId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const access = typeof pageId === "string" ? await getPageAccess(prisma, user.id, pageId) : null;
  if (!access || !atLeast(access.access, "EDIT")) return { error: "この版に戻す権限がありません。" };
  if (!(await findVersion(pageId, versionId))) return { error: "この版は見つかりません。" };
  try {
    await restoreVersion(pageId, versionId, user.id);
  } catch (err) {
    console.error("[history] restore failed", err);
    return { error: "この版に戻せませんでした。もう一度お試しください。" };
  }
  return {};
}
