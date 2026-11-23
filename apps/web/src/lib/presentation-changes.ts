import { saveCurrentVersion } from "@/lib/collab-events";
import { prisma } from "@/lib/db";
import { captureSnapshot, snapshotDue } from "@/lib/presentation-history";

// Saves the edits open on the presentation's slides as versions, so that a
// snapshot points at what's on screen.
export async function flushSlides(deckId: string): Promise<void> {
  const slides = await prisma.page.findMany({
    where: { parentId: deckId, kind: "SLIDE", deletedAt: null },
    select: { id: true },
  });
  for (const slide of slides) await saveCurrentVersion(slide.id);
}

// Before a change to what a presentation is made of: keeps how it was, at
// most once per version interval. Never stops the change.
export async function beforePresentationChange(deckId: string, userId: string): Promise<void> {
  try {
    if (!(await snapshotDue(prisma, deckId))) return;
    await flushSlides(deckId);
    await captureSnapshot(prisma, deckId, "AUTO", userId);
  } catch (err) {
    console.error("[presentation] saving a snapshot failed", err);
  }
}
