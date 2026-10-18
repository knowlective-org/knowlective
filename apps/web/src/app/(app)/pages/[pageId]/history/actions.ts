"use server";

import { getTranslations } from "next-intl/server";
import { atLeast, decrypt, encrypt, getPageAccess, loadDataKey } from "shared";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { prisma } from "@/lib/db";
import { recordAudit, userLabel } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { liveDocumentState, restoreVersion } from "@/lib/collab-events";
import { versionAad } from "@/lib/page-versions";
import {
  MAX_MASK_LENGTH,
  MAX_MASK_STRINGS,
  MIN_MASK_LENGTH,
  maskText,
  maskVersionState,
  normalizeMaskStrings,
} from "@/lib/version-mask";

// Page history. Viewing needs access to the page (VIEW); restoring and masking
// need EDIT. Masked versions can't be restored.
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
  const t = await getTranslations("history.errors");
  const access = typeof pageId === "string" ? await getPageAccess(prisma, user.id, pageId) : null;
  if (!access || !atLeast(access.access, "EDIT")) return { error: t("noPermission") };
  if (access.lock) return { error: t("locked") };
  const version = await findVersion(pageId, versionId);
  if (!version) return { error: t("notFound") };
  if (version.maskedAt) return { error: t("masked") };
  try {
    await restoreVersion(pageId, versionId, user.id);
  } catch (err) {
    console.error("[history] restore failed", err);
    return { error: t("failed") };
  }
  return {};
}

// ---- Masking (e.g. a password typed by mistake) ----------------------------
// The strings arrive as Server Action arguments and are only used here: they
// are never stored, logged, or returned.

type MaskCheck = { versions: number; matches: number; inCurrent: boolean };
// The errors of checkMask() / applyMask(), in the request's language.
async function maskErrors() {
  const t = await getTranslations("history.errors");
  return {
    noPermission: t("noMaskPermission"),
    badStrings: t("badStrings", { max: MAX_MASK_STRINGS, min: MIN_MASK_LENGTH, maxLength: MAX_MASK_LENGTH }),
    stillInPage: t("stillInPage"),
  };
}

async function editablePage(userId: string, pageId: unknown) {
  if (typeof pageId !== "string") return null;
  const access = await getPageAccess(prisma, userId, pageId);
  return access && atLeast(access.access, "EDIT") ? pageId : null;
}

// Matches in every version, and whether the page itself (live document, or
// the stored one if nobody has it open, plus its title) still contains them.
async function scan(pageId: string, strings: string[]) {
  const key = await loadDataKey(prisma);
  const [versions, page, stored] = await Promise.all([
    prisma.pageVersion.findMany({ where: { pageId }, select: { id: true, state: true, title: true } }),
    prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { title: true } }),
    prisma.pageDocument.findUnique({ where: { pageId }, select: { state: true } }),
  ]);
  const current = liveDocumentState(pageId) ?? (stored ? decrypt(key, stored.state, pageId) : null);
  const inCurrent =
    maskText(page.title, strings).count > 0 || (current !== null && maskVersionState(Uint8Array.from(current), strings).count > 0);
  const hits = versions
    .map((v) => {
      const masked = maskVersionState(Uint8Array.from(decrypt(key, v.state, versionAad(pageId, v.id))), strings);
      return { id: v.id, title: v.title, ...masked };
    })
    .filter((v) => v.count > 0);
  return { key, page, inCurrent, hits };
}

export async function checkMask(pageId: string, rawStrings: string[]): Promise<MaskCheck | { error: string }> {
  const user = await requireUser();
  const errors = await maskErrors();
  const id = await editablePage(user.id, pageId);
  if (!id) return { error: errors.noPermission };
  const strings = normalizeMaskStrings(rawStrings);
  if (!strings) return { error: errors.badStrings };
  const { inCurrent, hits } = await scan(id, strings);
  return { versions: hits.length, matches: hits.reduce((n, h) => n + h.count, 0), inCurrent };
}

export async function applyMask(pageId: string, rawStrings: string[]): Promise<MaskCheck | { error: string }> {
  const user = await requireUser();
  const errors = await maskErrors();
  const id = await editablePage(user.id, pageId);
  if (!id) return { error: errors.noPermission };
  const strings = normalizeMaskStrings(rawStrings);
  if (!strings) return { error: errors.badStrings };
  const { key, page, inCurrent, hits } = await scan(id, strings);
  // Otherwise the next saved version would contain it again.
  if (inCurrent) {
    return { error: errors.stillInPage };
  }
  if (hits.length === 0) return { versions: 0, matches: 0, inCurrent: false };

  const now = new Date();
  await prisma.$transaction(
    hits.map((h) =>
      prisma.pageVersion.update({
        where: { id: h.id },
        data: {
          state: Uint8Array.from(encrypt(key, h.state, versionAad(id, h.id))),
          title: maskText(h.title, strings).text,
          maskedAt: now,
          maskedById: user.id,
        },
      }),
    ),
  );
  const matches = hits.reduce((n, h) => n + h.count, 0);
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.version.mask",
    audit("audit.versionMask", {
      title: displayTitleWith(audit)(maskText(page.title, strings).text),
      versions: hits.length,
      matches,
    }),
    { pageId: id, versionIds: hits.map((h) => h.id), matches },
  );
  return { versions: hits.length, matches, inCurrent: false };
}
