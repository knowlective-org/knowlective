"use server";

import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

// Following a page: its changes by others are notified (server/notifications.ts).
// Anyone who can open the page can follow it.
export async function setPageFollow(pageId: string, follow: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof pageId !== "string" || typeof follow !== "boolean") return { ok: false };
  if (!(await getPageAccess(prisma, user.id, pageId))) return { ok: false };
  if (follow) {
    await prisma.pageFollow.upsert({
      where: { userId_pageId: { userId: user.id, pageId } },
      create: { userId: user.id, pageId },
      update: {},
    });
  } else {
    await prisma.pageFollow.deleteMany({ where: { userId: user.id, pageId } });
  }
  return { ok: true };
}
