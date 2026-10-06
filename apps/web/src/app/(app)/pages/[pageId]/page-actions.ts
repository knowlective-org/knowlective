"use server";

import { getPageAccess } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

export type PageInfo = {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
};

const displayName = (u: { name: string | null; email: string } | null) => (u ? u.name || u.email : null);

// Shown in the page menu. Loaded when the menu opens, so the times are
// current even after a long editing session.
export async function loadPageInfo(pageId: string): Promise<PageInfo | null> {
  const user = await requireUser();
  if (typeof pageId !== "string" || !(await getPageAccess(prisma, user.id, pageId))) return null;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { name: true, email: true } },
      updatedBy: { select: { name: true, email: true } },
    },
  });
  if (!page) return null;
  return {
    createdBy: displayName(page.createdBy) ?? "",
    createdAt: page.createdAt.toISOString(),
    updatedBy: displayName(page.updatedBy),
    updatedAt: page.updatedAt.toISOString(),
  };
}
