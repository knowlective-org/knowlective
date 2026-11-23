import * as Y from "yjs";
import { currentPageState } from "@/lib/api/page-content";
import { changeWhiteboard, closeDocuments, notifyChildrenChanged, reconnectDocuments } from "@/lib/collab-events";
import { prisma } from "@/lib/db";
import { adoptFiles } from "@/lib/file-copy";
import { insertChildPage } from "@/lib/page-create";
import { MoveConflictError, executeMove, planMove } from "@/lib/page-move";
import { beforePresentationChange } from "@/lib/presentation-changes";
import { type DeckView, loadDeck } from "@/lib/presentation-data";
import { lockPresentations } from "@/lib/presentation-tree";
import { FILE_URL, readItems, readSlideBackground, isBox } from "@/lib/whiteboard";

// Changing a presentation's slides, with the same checks wherever it's asked
// from (the screen's Server Actions, the public API, MCP). The caller has
// authenticated `userId`. Errors are codes: each caller words them.

export type SlideError = "not_found" | "forbidden" | "page_locked" | "too_many_slides" | "conflict";
// A file a move would copy into the new presentation.
export type PendingFile = { id: string; name: string };

export type SlideResult<T = object> = (T & { error?: undefined }) | { error: SlideError; message?: string };

// The presentation, if the person can change what it's made of.
async function changeableDeck(userId: string, deckId: unknown): Promise<DeckView | { error: SlideError }> {
  const deck = await loadDeck(userId, deckId);
  if (!deck) return { error: "not_found" };
  if (deck.canEdit) return deck;
  const page = await prisma.page.findUnique({ where: { id: deck.id }, select: { lockedAt: true } });
  // Locked here or further up, for someone who could otherwise edit it.
  return { error: page?.lockedAt || deck.slides.some((s) => s.canReadNotes) ? "page_locked" : "forbidden" };
}

// A new empty slide right after `afterId` (null: at the end).
export async function addSlideTo(userId: string, deckId: string, afterId: string | null): Promise<SlideResult<{ id: string }>> {
  const deck = await changeableDeck(userId, deckId);
  if ("error" in deck) return deck;
  await beforePresentationChange(deck.id, userId);
  const created = await insertChildPage(userId, deck.id, "", "SLIDE");
  if ("error" in created) {
    if (created.error === "tooManySlides") return { error: "too_many_slides" };
    if (created.error === "presentationLocked" || created.error === "lockedWithChildren") return { error: "page_locked" };
    return { error: "forbidden" };
  }
  if (typeof afterId === "string") {
    const order = deck.slides.map((s) => s.id);
    const at = order.indexOf(afterId);
    const beforeId = at >= 0 ? (order[at + 1] ?? null) : null;
    if (beforeId) {
      const plan = await planMove(userId, created.id, deck.id, beforeId);
      if (!("error" in plan)) {
        // It stays last if the slides changed meanwhile.
        await executeMove(plan).catch((err) => {
          if (!(err instanceof MoveConflictError)) throw err;
        });
      }
    }
  }
  notifyChildrenChanged(deck.id);
  return { id: created.id };
}

// Hides a slide from presenting and the PDF, or only its number.
export async function setSlideFlagFor(
  userId: string,
  deckId: string,
  slideId: string,
  flag: "hidden" | "numberHidden",
  value: boolean,
): Promise<SlideResult> {
  const deck = await loadDeck(userId, deckId);
  const slide = deck?.slides.find((s) => s.id === slideId);
  if (!deck || !slide) return { error: "not_found" };
  if (!slide.canEdit) return { error: slide.canReadNotes ? "page_locked" : "forbidden" };
  await beforePresentationChange(deck.id, userId);
  await prisma.$transaction(async (tx) => {
    await lockPresentations(tx, [deck.id]);
    const row = await tx.presentationSettings.findUnique({ where: { pageId: deck.id } });
    const current = (flag === "hidden" ? row?.hiddenSlideIds : row?.numberHiddenSlideIds) ?? [];
    const next = value ? [...new Set([...current, slide.id])] : current.filter((id) => id !== slide.id);
    const data = flag === "hidden" ? { hiddenSlideIds: next } : { numberHiddenSlideIds: next };
    await tx.presentationSettings.upsert({ where: { pageId: deck.id }, create: { pageId: deck.id, ...data }, update: data });
  });
  notifyChildrenChanged(deck.id);
  return {};
}

const fileIdOf = (src: string) => src.slice(src.lastIndexOf("/") + 1);

// The attachments a slide shows: its images and its background.
async function slideFiles(slideId: string) {
  const state = await currentPageState(slideId);
  if (!state) return { images: [], background: null };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const images = readItems(doc).flatMap((i) => (isBox(i) && FILE_URL.test(i.src) ? [{ id: i.id, src: i.src }] : []));
  const background = readSlideBackground(doc).image;
  doc.destroy();
  return { images, background };
}

// The files a move into `deckId` would have to copy. Whoever can edit a
// slide can put any file's URL on it, so a file isn't copied on the mover's
// access until they've seen its name and approved it (as in lib/file-copy.ts).
export async function pendingSlideFiles(userId: string, slideId: string, deckId: string): Promise<PendingFile[]> {
  const { images, background } = await slideFiles(slideId);
  const ids = [...images.map((i) => fileIdOf(i.src)), ...(background ? [fileIdOf(background)] : [])];
  if (ids.length === 0) return [];
  return (await adoptFiles(userId, deckId, ids, false)).pending;
}

// A slide now in another presentation: its images and background become that
// presentation's. Only the files in `approved` are copied; files it holds
// already are just pointed at. The others keep their URL (those who can open
// where they came from still see them) and are returned.
export async function adoptSlideImages(userId: string, slideId: string, deckId: string, approved: unknown = []): Promise<PendingFile[]> {
  const { images, background } = await slideFiles(slideId);
  const ids = [...new Set([...images.map((i) => fileIdOf(i.src)), ...(background ? [fileIdOf(background)] : [])])];
  if (ids.length === 0) return [];
  const first = await adoptFiles(userId, deckId, ids, false);
  const allowed = new Set(Array.isArray(approved) ? approved.filter((id): id is string => typeof id === "string") : []);
  const toCopy = first.pending.filter((f) => allowed.has(f.id));
  const copied = toCopy.length > 0 ? (await adoptFiles(userId, deckId, toCopy.map((f) => f.id), true)).urls : {};
  const urlOf = (src: string) => copied[fileIdOf(src)] ?? first.urls[fileIdOf(src)] ?? null;
  const set = images.flatMap((i) => {
    const url = urlOf(i.src);
    return url && url !== i.src ? [{ id: i.id, fields: { src: url } }] : [];
  });
  const newBackground = background ? urlOf(background) : null;
  const backgroundImage = newBackground && newBackground !== background ? newBackground : undefined;
  if (set.length > 0 || backgroundImage) await changeWhiteboard(slideId, userId, { set, remove: [], backgroundImage });
  return first.pending.filter((f) => !allowed.has(f.id));
}

// Moves a slide before `beforeId` (null: last), in its presentation or into
// `toDeckId`, copying only the files in `copyFileIds`. `pendingFiles`: those
// left uncopied.
export async function moveSlideTo(
  userId: string,
  deckId: string,
  slideId: string,
  beforeId: string | null,
  toDeckId: string = deckId,
  copyFileIds: unknown = [],
): Promise<SlideResult<{ pendingFiles: PendingFile[] }>> {
  const deck = await loadDeck(userId, deckId);
  if (!deck?.slides.some((s) => s.id === slideId)) return { error: "not_found" };
  const plan = await planMove(userId, slideId, toDeckId, beforeId);
  if ("error" in plan) return { error: "conflict", message: plan.error };
  await beforePresentationChange(plan.fromParentId, userId);
  if (plan.parentChanges) await beforePresentationChange(plan.toParentId, userId);
  try {
    await executeMove(plan);
  } catch (err) {
    if (err instanceof MoveConflictError) return { error: "conflict" };
    throw err;
  }
  let pendingFiles: PendingFile[] = [];
  if (plan.parentChanges) {
    pendingFiles = await adoptSlideImages(userId, slideId, plan.toParentId, copyFileIds);
    reconnectDocuments([slideId]);
    notifyChildrenChanged(plan.fromParentId);
  }
  notifyChildrenChanged(plan.toParentId);
  return { pendingFiles };
}

// Copies files a slide's move left uncopied (`pendingFiles`), once approved.
export async function approveSlideFiles(
  userId: string,
  deckId: string,
  slideId: string,
  fileIds: unknown,
): Promise<SlideResult<{ pendingFiles: PendingFile[] }>> {
  const deck = await loadDeck(userId, deckId);
  const slide = deck?.slides.find((s) => s.id === slideId);
  if (!deck || !slide) return { error: "not_found" };
  if (!slide.canEdit) return { error: slide.canReadNotes ? "page_locked" : "forbidden" };
  const pendingFiles = await adoptSlideImages(userId, slide.id, deck.id, fileIds);
  notifyChildrenChanged(deck.id);
  return { pendingFiles };
}

// To the trash, like any page (it can be restored from there).
export async function removeSlide(userId: string, deckId: string, slideId: string): Promise<SlideResult> {
  const deck = await changeableDeck(userId, deckId);
  if ("error" in deck) return deck;
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return { error: "not_found" };
  if (!slide.canEdit) return { error: slide.canReadNotes ? "page_locked" : "forbidden" };
  await beforePresentationChange(deck.id, userId);
  await prisma.page.update({ where: { id: slide.id }, data: { deletedAt: new Date(), deletedById: userId } });
  closeDocuments([slide.id]);
  notifyChildrenChanged(deck.id);
  return {};
}
