"use server";

import { getTranslations } from "next-intl/server";
import { PAGE_ORDER, loadDataKey } from "shared";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { closeDocuments, notifyChildrenChanged, restoreVersion } from "@/lib/collab-events";
import { prisma } from "@/lib/db";
import { getTreeWithAccess } from "@/lib/page-access";
import { beforePresentationChange, flushSlides } from "@/lib/presentation-changes";
import { MAX_NOTE_LENGTH, captureSnapshot, openNote, openSnapshot, sealNote } from "@/lib/presentation-history";
import { MAX_SLIDES, isNumberPosition, isNumberStart } from "@/lib/presentation";
import { type SlideError, addSlideTo, setSlideFlagFor } from "@/lib/presentation-ops";
import { type DeckView, loadDeck, loadStates } from "@/lib/presentation-data";
import { lockPresentations } from "@/lib/presentation-tree";

// The presentation screen's reads and changes. Reads work for someone not
// logged in on a public presentation (lib/presentation-data.ts leaves hidden
// slides out for them); every change needs an account and EDIT.

export async function loadPresentation(deckId: string): Promise<DeckView | null> {
  const user = await getCurrentUser();
  return loadDeck(user?.id ?? null, deckId);
}

export async function loadSlideStates(deckId: string, slideIds: string[]): Promise<{ id: string; state: string }[]> {
  const user = await getCurrentUser();
  return loadStates(user?.id ?? null, deckId, slideIds);
}

async function slideError(code: SlideError, message?: string): Promise<{ error: string }> {
  const [t, pages] = await Promise.all([getTranslations("presentation"), getTranslations("pageErrors")]);
  if (message) return { error: message };
  if (code === "page_locked") return { error: pages("presentationLocked") };
  if (code === "too_many_slides") return { error: pages("tooManySlides", { max: MAX_SLIDES }) };
  return { error: t("cannotChange") };
}

// A new empty slide right after `afterId` (null: at the end).
export async function addSlide(deckId: string, afterId: string | null): Promise<{ id: string } | { error: string }> {
  const user = await requireUser();
  const result = await addSlideTo(user.id, deckId, afterId);
  return result.error ? slideError(result.error, result.message) : { id: result.id };
}

// Hides a slide from presenting and the PDF, or only its number.
export async function setSlideFlag(
  deckId: string,
  slideId: string,
  flag: "hidden" | "numberHidden",
  value: boolean,
): Promise<{ error?: string }> {
  const user = await requireUser();
  if ((flag !== "hidden" && flag !== "numberHidden") || typeof value !== "boolean") {
    return { error: (await getTranslations("presentation"))("cannotChange") };
  }
  const result = await setSlideFlagFor(user.id, deckId, slideId, flag, value);
  return result.error ? slideError(result.error, result.message) : {};
}

export async function saveNumbering(
  deckId: string,
  input: { enabled: boolean; start: number; position: string },
): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("presentation");
  if (typeof input?.enabled !== "boolean" || !isNumberStart(input.start) || !isNumberPosition(input.position)) {
    return { error: t("cannotChange") };
  }
  const deck = await loadDeck(user.id, deckId);
  if (!deck?.canEdit) return { error: t("cannotChange") };
  await beforePresentationChange(deck.id, user.id);
  const data = { numberingEnabled: input.enabled, numberStart: input.start, numberPosition: input.position };
  await prisma.presentationSettings.upsert({ where: { pageId: deck.id }, create: { pageId: deck.id, ...data }, update: data });
  notifyChildrenChanged(deck.id);
  return {};
}

// A slide's speaker notes: only for people with edit access to it.
export async function loadSlideNote(deckId: string, slideId: string): Promise<{ text: string } | null> {
  const user = await requireUser();
  const deck = await loadDeck(user.id, deckId);
  if (!deck?.slides.find((s) => s.id === slideId)?.canReadNotes) return null;
  const note = await prisma.slideNote.findUnique({ where: { slideId } });
  return { text: note ? openNote(await loadDataKey(prisma), slideId, note.textEnc) : "" };
}

export async function saveSlideNote(deckId: string, slideId: string, text: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("presentation");
  if (typeof text !== "string" || text.length > MAX_NOTE_LENGTH) return { error: t("cannotChange") };
  const deck = await loadDeck(user.id, deckId);
  if (!deck?.slides.find((s) => s.id === slideId)?.canEdit) return { error: t("cannotChange") };
  await beforePresentationChange(deck.id, user.id);
  if (text === "") {
    await prisma.slideNote.deleteMany({ where: { slideId } });
    return {};
  }
  const textEnc = sealNote(await loadDataKey(prisma), slideId, text);
  await prisma.slideNote.upsert({
    where: { slideId },
    create: { slideId, textEnc, updatedById: user.id },
    update: { textEnc, updatedById: user.id },
  });
  return {};
}

// Puts the presentation back as it was in a snapshot: its slides, their
// order and content, notes and settings. What it replaces is kept first (a
// snapshot, and a version of each slide). Slides moved to another
// presentation since, and versions masked since, are left as they are and
// counted in `skipped`.
export async function restorePresentationSnapshot(
  deckId: string,
  snapshotId: string,
): Promise<{ skipped: number } | { error: string }> {
  const user = await requireUser();
  const t = await getTranslations("presentation");
  const deck = await loadDeck(user.id, deckId);
  if (!deck?.canEdit) return { error: t("cannotChange") };
  const row = typeof snapshotId === "string" ? await prisma.presentationSnapshot.findUnique({ where: { id: snapshotId } }) : null;
  if (!row || row.pageId !== deck.id) return { error: t("cannotChange") };
  const key = await loadDataKey(prisma);
  const payload = openSnapshot(key, deck.id, row.id, row.sealed);

  const page = await prisma.page.findUniqueOrThrow({ where: { id: deck.id }, select: { rootId: true } });
  const tree = await getTreeWithAccess(prisma, user.id, page.rootId);
  const children = await prisma.page.findMany({
    where: { parentId: deck.id, kind: "SLIDE" },
    orderBy: PAGE_ORDER,
    select: { id: true, deletedAt: true },
  });
  const here = new Set(children.map((c) => c.id));
  const wanted = payload.slides.filter((s) => here.has(s.id)).slice(0, MAX_SLIDES);
  const wantedIds = new Set(wanted.map((s) => s.id));
  const extras = children.filter((c) => !c.deletedAt && !wantedIds.has(c.id)).map((c) => c.id);
  // Everything it would change must be editable and unlocked.
  const blocked = [...wantedIds, ...extras].some((id) => tree.locks.has(id) || !["EDIT", "MANAGE"].includes(tree.access.get(id) ?? ""));
  if (blocked) return { error: t("restoreBlocked") };

  await flushSlides(deck.id);
  await captureSnapshot(prisma, deck.id, "BEFORE_RESTORE", user.id);

  const ordered = [...wanted.map((s) => s.id), ...children.map((c) => c.id).filter((id) => !wantedIds.has(id))];
  await prisma.$transaction(async (tx) => {
    await lockPresentations(tx, [deck.id]);
    const current = await tx.presentationSettings.findUnique({
      where: { pageId: deck.id },
      select: { hiddenSlideIds: true, numberHiddenSlideIds: true },
    });
    // A restore never shows a slide that's hidden now: on a public
    // presentation that would hand it to everyone. Showing it again is a
    // choice of its own. Slides the snapshot doesn't place keep their flags.
    const hidden = [
      ...new Set([
        ...payload.settings.hiddenSlideIds.filter((id) => wantedIds.has(id)),
        ...(current?.hiddenSlideIds ?? []).filter((id) => here.has(id)),
      ]),
    ];
    const numberHidden = [
      ...new Set([
        ...payload.settings.numberHiddenSlideIds.filter((id) => wantedIds.has(id)),
        ...(current?.numberHiddenSlideIds ?? []).filter((id) => here.has(id) && !wantedIds.has(id)),
      ]),
    ];
    const settings = {
      numberingEnabled: payload.settings.numberingEnabled,
      numberStart: payload.settings.numberStart,
      numberPosition: payload.settings.numberPosition,
      hiddenSlideIds: hidden,
      numberHiddenSlideIds: numberHidden,
    };
    await tx.page.updateMany({ where: { id: { in: [...wantedIds] }, parentId: deck.id }, data: { deletedAt: null, deletedById: null } });
    if (extras.length > 0) {
      await tx.page.updateMany({ where: { id: { in: extras }, parentId: deck.id }, data: { deletedAt: new Date(), deletedById: user.id } });
    }
    await tx.$executeRaw`
      UPDATE "Page" AS p SET "sortOrder" = v.ord
      FROM unnest(${ordered}::text[], ${ordered.map((_, i) => i)}::int[]) AS v(id, ord)
      WHERE p."id" = v.id AND p."parentId" = ${deck.id}`;
    await tx.presentationSettings.upsert({ where: { pageId: deck.id }, create: { pageId: deck.id, ...settings }, update: settings });
    for (const slide of wanted) {
      if (slide.note) {
        const textEnc = sealNote(key, slide.id, slide.note);
        await tx.slideNote.upsert({
          where: { slideId: slide.id },
          create: { slideId: slide.id, textEnc, updatedById: user.id },
          update: { textEnc, updatedById: user.id },
        });
      } else {
        await tx.slideNote.deleteMany({ where: { slideId: slide.id } });
      }
    }
  });
  if (extras.length > 0) closeDocuments(extras);

  // The content, for the slides whose latest version isn't the one wanted.
  const latest = await prisma.pageVersion.findMany({
    where: { pageId: { in: [...wantedIds] } },
    orderBy: [{ pageId: "asc" }, { createdAt: "desc" }],
    distinct: ["pageId"],
    select: { id: true, pageId: true },
  });
  const latestOf = new Map(latest.map((v) => [v.pageId, v.id]));
  const versionIds = wanted.flatMap((s) => (s.versionId ? [s.versionId] : []));
  const versions = await prisma.pageVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, pageId: true, maskedAt: true } });
  const usable = new Map(versions.map((v) => [v.id, v]));
  let skipped = payload.slides.length - wanted.length;
  for (const slide of wanted) {
    const current = latestOf.get(slide.id) ?? null;
    if (current === slide.versionId) continue;
    if (slide.versionId) {
      const version = usable.get(slide.versionId);
      if (!version || version.pageId !== slide.id || version.maskedAt) {
        skipped++;
        continue;
      }
    }
    await restoreVersion(slide.id, slide.versionId, user.id);
  }
  await captureSnapshot(prisma, deck.id, "RESTORED", user.id);
  notifyChildrenChanged(deck.id);
  return { skipped };
}
