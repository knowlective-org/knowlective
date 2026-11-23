import { randomUUID } from "node:crypto";
import { PAGE_ORDER, type PrismaClient, decrypt, encrypt, loadDataKey } from "shared";
import { VERSION_INTERVAL_MS } from "./page-versions";
import { type PresentationSettingsView, readSettings } from "./presentation";

// A presentation's history: snapshots of what it's made of at a moment (the
// slides in order with the version of each, their speaker notes, and the
// settings), kept on the presentation. Encrypted as one value. Also used by
// the collab server: relative imports, and the caller's Prisma client.

export type SnapshotKind = "AUTO" | "BEFORE_RESTORE" | "RESTORED";
export type SnapshotSlide = { id: string; versionId: string | null; note: string };
export type SnapshotPayload = {
  settings: Pick<PresentationSettingsView, "numberingEnabled" | "numberStart" | "numberPosition" | "hiddenSlideIds" | "numberHiddenSlideIds">;
  slides: SnapshotSlide[];
};

export const MAX_NOTE_LENGTH = 20_000;
export const snapshotAad = (pageId: string, id: string) => `knowlective:presentation-snapshot:${pageId}:${id}`;
export const noteAad = (slideId: string) => `knowlective:slide-note:${slideId}`;

type Db = Pick<PrismaClient, "page" | "pageVersion" | "presentationSettings" | "presentationSnapshot" | "slideNote" | "instanceConfig">;
type Key = Awaited<ReturnType<typeof loadDataKey>>;

export const sealNote = (key: Key, slideId: string, text: string) =>
  Uint8Array.from(encrypt(key, Buffer.from(text, "utf8"), noteAad(slideId)));
export const openNote = (key: Key, slideId: string, sealed: Uint8Array) =>
  Buffer.from(decrypt(key, sealed, noteAad(slideId))).toString("utf8");

export const sealSnapshot = (key: Key, pageId: string, id: string, payload: SnapshotPayload) =>
  Uint8Array.from(encrypt(key, Buffer.from(JSON.stringify(payload), "utf8"), snapshotAad(pageId, id)));
export const openSnapshot = (key: Key, pageId: string, id: string, sealed: Uint8Array) =>
  JSON.parse(Buffer.from(decrypt(key, sealed, snapshotAad(pageId, id))).toString("utf8")) as SnapshotPayload;

// Records the presentation as it is now.
export async function captureSnapshot(prisma: Db, deckId: string, kind: SnapshotKind, userId: string | null): Promise<void> {
  const key = await loadDataKey(prisma as PrismaClient);
  const [slides, settings] = await Promise.all([
    prisma.page.findMany({ where: { parentId: deckId, kind: "SLIDE", deletedAt: null }, orderBy: PAGE_ORDER, select: { id: true } }),
    prisma.presentationSettings.findUnique({ where: { pageId: deckId } }),
  ]);
  const ids = slides.map((s) => s.id);
  const [latest, notes] = await Promise.all([
    prisma.pageVersion.findMany({
      where: { pageId: { in: ids } },
      orderBy: [{ pageId: "asc" }, { createdAt: "desc" }],
      distinct: ["pageId"],
      select: { id: true, pageId: true },
    }),
    prisma.slideNote.findMany({ where: { slideId: { in: ids } } }),
  ]);
  const versionOf = new Map(latest.map((v) => [v.pageId, v.id]));
  const noteOf = new Map(notes.map((n) => [n.slideId, openNote(key, n.slideId, n.textEnc)]));
  const stored = readSettings(settings);
  const payload: SnapshotPayload = {
    settings: {
      numberingEnabled: stored.numberingEnabled,
      numberStart: stored.numberStart,
      numberPosition: stored.numberPosition,
      hiddenSlideIds: stored.hiddenSlideIds,
      numberHiddenSlideIds: stored.numberHiddenSlideIds,
    },
    slides: ids.map((id) => ({ id, versionId: versionOf.get(id) ?? null, note: noteOf.get(id) ?? "" })),
  };
  const id = randomUUID();
  await prisma.presentationSnapshot.create({
    data: { id, pageId: deckId, kind, createdById: userId, slideIds: ids, sealed: sealSnapshot(key, deckId, id, payload) },
  });
}

// Whether it's time for another automatic snapshot.
export async function snapshotDue(prisma: Pick<Db, "presentationSnapshot">, deckId: string): Promise<boolean> {
  const last = await prisma.presentationSnapshot.findFirst({
    where: { pageId: deckId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return !last || Date.now() - last.createdAt.getTime() >= VERSION_INTERVAL_MS;
}
