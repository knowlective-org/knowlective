import { getUsersWithPageAccess, type PrismaClient } from "shared";

// Who can be given a TODO or mentioned on a page: those who can open it and
// have a name. Nobody is offered, or shown, by their email address (a page's
// viewers would see everyone's). The mention and assignee menus, the chat and
// search all go by this, so a mention of anyone else (an id written into a
// message by hand) names nobody.
export async function pagePeople(prisma: PrismaClient, pageId: string): Promise<{ id: string; name: string }[]> {
  const users = await getUsersWithPageAccess(prisma, pageId);
  return users.flatMap((u) => (u.name ? [{ id: u.id, name: u.name }] : []));
}

export async function pagePeopleNames(prisma: PrismaClient, pageId: string): Promise<Map<string, string>> {
  return new Map((await pagePeople(prisma, pageId)).map((p) => [p.id, p.name]));
}
