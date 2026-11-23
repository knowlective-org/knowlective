import type { Prisma } from "shared";
import { MAX_SLIDES } from "@/lib/presentation";

// A presentation's slides in the page tree: the checks that have to hold
// while slides are added or moved, inside the caller's transaction.

// Locks the presentations' rows until the transaction ends, so that two
// requests can't both take the last free place. In id order: no deadlocks.
export async function lockPresentations(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT 1 FROM "Page" WHERE "id" = ${id} FOR UPDATE`;
  }
}

export const liveSlideCount = (tx: Pick<Prisma.TransactionClient, "page">, presentationId: string) =>
  tx.page.count({ where: { parentId: presentationId, kind: "SLIDE", deletedAt: null } });

// Whether another slide fits (the caller holds lockPresentations()).
export async function hasRoomForSlide(tx: Prisma.TransactionClient, presentationId: string): Promise<boolean> {
  return (await liveSlideCount(tx, presentationId)) < MAX_SLIDES;
}

// A slide moved to another presentation keeps being hidden, or having its
// number hidden, there.
export async function carrySlideFlags(tx: Prisma.TransactionClient, slideId: string, fromId: string, toId: string): Promise<void> {
  const from = await tx.presentationSettings.findUnique({
    where: { pageId: fromId },
    select: { hiddenSlideIds: true, numberHiddenSlideIds: true },
  });
  if (!from) return;
  const hidden = from.hiddenSlideIds.includes(slideId);
  const numberHidden = from.numberHiddenSlideIds.includes(slideId);
  if (!hidden && !numberHidden) return;
  await tx.presentationSettings.update({
    where: { pageId: fromId },
    data: {
      hiddenSlideIds: from.hiddenSlideIds.filter((id) => id !== slideId),
      numberHiddenSlideIds: from.numberHiddenSlideIds.filter((id) => id !== slideId),
    },
  });
  const to = await tx.presentationSettings.findUnique({
    where: { pageId: toId },
    select: { hiddenSlideIds: true, numberHiddenSlideIds: true },
  });
  const hiddenIds = [...new Set([...(to?.hiddenSlideIds ?? []), ...(hidden ? [slideId] : [])])];
  const numberHiddenIds = [...new Set([...(to?.numberHiddenSlideIds ?? []), ...(numberHidden ? [slideId] : [])])];
  await tx.presentationSettings.upsert({
    where: { pageId: toId },
    create: { pageId: toId, hiddenSlideIds: hiddenIds, numberHiddenSlideIds: numberHiddenIds },
    update: { hiddenSlideIds: hiddenIds, numberHiddenSlideIds: numberHiddenIds },
  });
}
