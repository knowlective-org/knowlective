"use server";

import { canEditPage } from "shared";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { getPageAccess } from "@/lib/page-access";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { REVIEW_PREFIX, type ReviewThreads, isReviewBlockId, reviewBlockOf } from "@/lib/review-threads";

// The page's review threads (lib/review-threads.ts): which blocks have one,
// how many messages, and whether it's resolved. For those who can open the
// page and are logged in (a public page's guests see no threads). The
// messages themselves are read and posted as a chat's (chat-actions.ts).
export async function loadReviewThreads(pageId: string): Promise<ReviewThreads | null> {
  const user = await getCurrentUser();
  if (!user || typeof pageId !== "string") return null;
  const access = await getPageAccess(prisma, user.id, pageId);
  if (!access) return null;
  const [counts, resolved] = await Promise.all([
    prisma.chatMessage.groupBy({
      by: ["blockId"],
      where: { pageId, blockId: { startsWith: REVIEW_PREFIX }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.reviewThread.findMany({ where: { pageId, resolvedAt: { not: null } }, select: { blockId: true } }),
  ]);
  const done = new Set(resolved.map((r) => r.blockId));
  return {
    threads: counts.flatMap((c) => {
      const blockId = reviewBlockOf(c.blockId);
      return blockId ? [{ blockId, count: c._count._all, resolved: done.has(blockId) }] : [];
    }),
    canPost: canEditPage(access),
  };
}

// Marks the thread about `blockId` resolved (or open again). Needs what
// posting needs: edit access, the page not locked.
export async function setReviewResolved(pageId: string, blockId: string, resolved: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("pageErrors");
  if (typeof pageId !== "string" || !isReviewBlockId(blockId) || typeof resolved !== "boolean") return { error: t("notAllowed") };
  const access = await getPageAccess(prisma, user.id, pageId);
  if (!access || !canEditPage(access)) return { error: t("notAllowed") };
  const resolution = resolved ? { resolvedAt: new Date(), resolvedById: user.id } : { resolvedAt: null, resolvedById: null };
  await prisma.reviewThread.upsert({
    where: { pageId_blockId: { pageId, blockId } },
    create: { pageId, blockId, ...resolution },
    update: resolution,
  });
  // Others with the page open see it at once.
  notifyChildrenChanged(pageId);
  return {};
}
