"use server";

import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { pagePeople } from "@/lib/page-people";

export type PagePeople = { id: string; name: string }[];

// The people who can open the page and have a name (lib/page-people.ts):
// whom a TODO can be given to and who can be mentioned (@name), and the names
// they're shown with (components/editor/page-people.ts). Not for someone not
// logged in (a public page): people's names aren't public.
export async function loadPagePeople(pageId: string): Promise<PagePeople | null> {
  const user = await getCurrentUser();
  if (!user || typeof pageId !== "string") return null;
  if (!(await getPageAccess(prisma, user.id, pageId))) return null;
  return pagePeople(prisma, pageId);
}
