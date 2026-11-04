"use server";

import { getUsersWithPageAccess } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

export type TodoPeople = { id: string; name: string }[];

// The people a TODO block (components/editor/todo-block.tsx) can be given
// to, those who can open the page, with their names; also used for the name
// of whoever ticked an item. Not for someone not logged in (a public page):
// people's names aren't public.
export async function loadTodoPeople(pageId: string): Promise<TodoPeople | null> {
  const user = await getCurrentUser();
  if (!user || typeof pageId !== "string") return null;
  if (!(await getPageAccess(prisma, user.id, pageId))) return null;
  const users = await getUsersWithPageAccess(prisma, pageId);
  return users.map((u) => ({ id: u.id, name: u.name || u.email }));
}
