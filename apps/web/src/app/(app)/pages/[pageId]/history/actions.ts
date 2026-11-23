"use server";

import { getTranslations } from "next-intl/server";
import { atLeast, decrypt, encrypt, loadDataKey } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { prisma } from "@/lib/db";
import { recordAudit, userLabel } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { liveDocumentState, restoreVersion, saveCurrentVersion } from "@/lib/collab-events";
import { versionAad } from "@/lib/page-versions";
import { storedVersionState } from "@/lib/version-store";
import { openNote, openSnapshot, sealSnapshot } from "@/lib/presentation-history";
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
  const state = await storedVersionState(prisma, await loadDataKey(prisma), pageId, version.id);
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

// Before the editor replaces the whole page (title and body) with a Markdown
// file: the current state goes into the history first, so the replacement
// can be undone from there.
export async function saveVersionBeforeReplace(pageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.replaceErrors");
  const access = typeof pageId === "string" ? await getPageAccess(prisma, user.id, pageId) : null;
  if (!access || !atLeast(access.access, "EDIT")) return { error: t("noPermission") };
  if (access.lock) return { error: t("locked") };
  try {
    await saveCurrentVersion(pageId);
  } catch (err) {
    console.error("[history] saving the version before a replace failed", err);
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
  const [versions, page, stored, slide] = await Promise.all([
    prisma.pageVersion.findMany({ where: { pageId }, select: { id: true, baseId: true, title: true } }),
    prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { title: true } }),
    prisma.pageDocument.findUnique({ where: { pageId }, select: { state: true } }),
    prisma.page.findUnique({
      where: { id: pageId },
      select: { kind: true, parentId: true, slideNote: { select: { textEnc: true } } },
    }),
  ]);
  const current = liveDocumentState(pageId) ?? (stored ? decrypt(key, stored.state, pageId) : null);
  // A slide's speaker notes are outside its versions: the current note, and
  // the copies in its presentation's snapshots.
  const isSlide = slide?.kind === "SLIDE" && !!slide.parentId;
  const noteNow = isSlide && slide.slideNote ? openNote(key, pageId, slide.slideNote.textEnc) : "";
  // In every presentation it has been in, not only its current one. (Rows
  // without the list are from before it was kept: they're read too.)
  const snapshots = isSlide
    ? await prisma.presentationSnapshot.findMany({ where: { OR: [{ slideIds: { has: pageId } }, { slideIds: { isEmpty: true } }] } })
    : [];
  const noteHits = snapshots.flatMap((row) => {
    const payload = openSnapshot(key, row.pageId, row.id, row.sealed);
    let count = 0;
    const slides = payload.slides.map((s) => {
      if (s.id !== pageId || !s.note) return s;
      const masked = maskText(s.note, strings);
      count += masked.count;
      return { ...s, note: masked.text };
    });
    return count > 0 ? [{ id: row.id, pageId: row.pageId, count, sealed: sealSnapshot(key, row.pageId, row.id, { ...payload, slides }) }] : [];
  });
  const inCurrent =
    maskText(noteNow, strings).count > 0 ||
    maskText(page.title, strings).count > 0 || (current !== null && maskVersionState(Uint8Array.from(current), strings).count > 0);
  // Read whole, through their differences (lib/version-chain.ts).
  const whole = await Promise.all(
    versions.map(async (v) => ({ ...v, full: await storedVersionState(prisma, key, pageId, v.id) })),
  );
  const hits = whole
    .map((v) => ({ id: v.id, title: v.title, ...maskVersionState(v.full, strings) }))
    .filter((v) => v.count > 0);
  const hitIds = new Set(hits.map((h) => h.id));
  // A difference can't stay once a version it's built on is rebuilt, and an
  // older one may carry the text: all of them are stored whole again.
  const differences = whole.filter((v) => v.baseId !== null && !hitIds.has(v.id)).map((v) => ({ id: v.id, full: v.full }));
  return { key, page, inCurrent, hits, differences, noteHits };
}

export async function checkMask(pageId: string, rawStrings: string[]): Promise<MaskCheck | { error: string }> {
  const user = await requireUser();
  const errors = await maskErrors();
  const id = await editablePage(user.id, pageId);
  if (!id) return { error: errors.noPermission };
  const strings = normalizeMaskStrings(rawStrings);
  if (!strings) return { error: errors.badStrings };
  const { inCurrent, hits, noteHits } = await scan(id, strings);
  return {
    versions: hits.length + noteHits.length,
    matches: hits.reduce((n, h) => n + h.count, 0) + noteHits.reduce((n, h) => n + h.count, 0),
    inCurrent,
  };
}

export async function applyMask(pageId: string, rawStrings: string[]): Promise<MaskCheck | { error: string }> {
  const user = await requireUser();
  const errors = await maskErrors();
  const id = await editablePage(user.id, pageId);
  if (!id) return { error: errors.noPermission };
  const strings = normalizeMaskStrings(rawStrings);
  if (!strings) return { error: errors.badStrings };
  const { key, page, inCurrent, hits, differences, noteHits } = await scan(id, strings);
  // Otherwise the next saved version would contain it again.
  if (inCurrent) {
    return { error: errors.stillInPage };
  }
  if (hits.length === 0 && noteHits.length === 0) return { versions: 0, matches: 0, inCurrent: false };

  const now = new Date();
  await prisma.$transaction([
    ...hits.map((h) =>
      prisma.pageVersion.update({
        where: { id: h.id },
        data: {
          state: Uint8Array.from(encrypt(key, h.state, versionAad(id, h.id))),
          baseId: null,
          depth: 0,
          title: maskText(h.title, strings).text,
          maskedAt: now,
          maskedById: user.id,
        },
      }),
    ),
    ...differences.map((d) =>
      prisma.pageVersion.update({
        where: { id: d.id },
        data: { state: Uint8Array.from(encrypt(key, d.full, versionAad(id, d.id))), baseId: null, depth: 0 },
      }),
    ),
    ...noteHits.map((n) => prisma.presentationSnapshot.update({ where: { id: n.id }, data: { sealed: n.sealed } })),
  ]);
  const matches = hits.reduce((n, h) => n + h.count, 0) + noteHits.reduce((n, h) => n + h.count, 0);
  const changed = hits.length + noteHits.length;
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.version.mask",
    audit("audit.versionMask", {
      title: displayTitleWith(audit)(maskText(page.title, strings).text),
      versions: changed,
      matches,
    }),
    { pageId: id, versionIds: hits.map((h) => h.id), snapshotIds: noteHits.map((n) => n.id), matches },
    // The title hidden (lib/audit-pages.ts).
    audit("audit.versionMask", { title: audit("audit.hiddenPage"), versions: changed, matches }),
  );
  return { versions: changed, matches, inCurrent: false };
}
