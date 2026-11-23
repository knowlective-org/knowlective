import { atLeast } from "shared";
import { prisma } from "@/lib/db";
import { getVisibleTree } from "@/lib/page-access";
import { publicPageState } from "@/lib/public-page-state";
import { type PresentationSettingsView, readSettings, slideNumbers } from "@/lib/presentation";

// A presentation as one viewer sees it, with their own access. Someone not
// logged in (userId null) gets the shown slides only, and nothing that tells
// hidden ones exist.

export type DeckSlide = {
  id: string;
  updatedAt: string;
  // EDIT on the slide, and neither it nor the presentation locked.
  canEdit: boolean;
  // EDIT on the slide, locked or not: who gets its speaker notes.
  canReadNotes: boolean;
  locked: boolean;
  hidden: boolean;
  numberHidden: boolean;
  number: number | null;
};

export type DeckView = {
  id: string;
  // EDIT on the presentation, and it isn't locked.
  canEdit: boolean;
  settings: PresentationSettingsView;
  slides: DeckSlide[];
};

// At most this many slides' contents per request.
export const MAX_STATES_PER_REQUEST = 24;

export async function loadDeck(userId: string | null, deckId: unknown): Promise<DeckView | null> {
  if (typeof deckId !== "string") return null;
  const page = await prisma.page.findUnique({
    where: { id: deckId },
    select: { kind: true, rootId: true, presentation: true },
  });
  if (page?.kind !== "PRESENTATION") return null;
  const tree = await getVisibleTree(prisma, userId, page.rootId, { slides: true });
  const deck = tree?.pages.find((p) => p.id === deckId);
  if (!tree || !deck) return null;

  const stored = readSettings(page.presentation);
  const rows = tree.pages.filter((p) => p.parentId === deckId && p.kind === "SLIDE");
  const numbers = slideNumbers(rows.map((r) => r.id), stored);
  const hidden = new Set(stored.hiddenSlideIds);
  const numberHidden = new Set(stored.numberHiddenSlideIds);
  const deckEditable = atLeast(deck.access, "EDIT") && !deck.lock;
  const slides = rows
    .filter((r) => userId !== null || !hidden.has(r.id))
    .map((r) => ({
      id: r.id,
      updatedAt: r.updatedAt.toISOString(),
      canEdit: atLeast(r.access, "EDIT") && !r.lock,
      canReadNotes: atLeast(r.access, "EDIT"),
      locked: r.lock !== null,
      hidden: hidden.has(r.id),
      numberHidden: numberHidden.has(r.id),
      number: numbers.get(r.id) ?? null,
    }));
  const ids = new Set(slides.map((s) => s.id));
  return {
    id: deckId,
    canEdit: deckEditable,
    settings: {
      ...stored,
      hiddenSlideIds: stored.hiddenSlideIds.filter((id) => ids.has(id)),
      numberHiddenSlideIds: stored.numberHiddenSlideIds.filter((id) => ids.has(id)),
    },
    slides,
  };
}

// For someone not logged in: an attachment of a presentation or a slide is
// served only if a slide they get uses it. (Access to the presentation alone
// would also hand out what only a hidden slide shows, to anyone with the URL.)
export async function guestMayGetFile(file: { id: string; pageId: string }): Promise<boolean> {
  const page = await prisma.page.findUnique({ where: { id: file.pageId }, select: { kind: true, parentId: true } });
  if (page?.kind === "SLIDE") {
    const deck = await loadDeck(null, page.parentId);
    return !!deck?.slides.some((s) => s.id === file.pageId);
  }
  if (page?.kind !== "PRESENTATION") return true;
  const deck = await loadDeck(null, file.pageId);
  if (!deck) return false;
  const refs = await prisma.pageFileRefs.count({
    where: { pageId: { in: deck.slides.map((s) => s.id) }, fileIds: { has: file.id } },
  });
  return refs > 0;
}

// The contents of some of the slides the viewer gets (base64 Yjs states):
// current title and canvas only, without the edit history.
export async function loadStates(userId: string | null, deckId: unknown, slideIds: unknown): Promise<{ id: string; state: string }[]> {
  if (!Array.isArray(slideIds)) return [];
  const deck = await loadDeck(userId, deckId);
  if (!deck) return [];
  const allowed = new Set(deck.slides.map((s) => s.id));
  const ids = [...new Set(slideIds)].filter((id): id is string => typeof id === "string" && allowed.has(id)).slice(0, MAX_STATES_PER_REQUEST);
  return Promise.all(ids.map(async (id) => ({ id, state: await publicPageState(id, "") })));
}
