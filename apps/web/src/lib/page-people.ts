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

// Everyone who can open the page (named or not): who a mention of everyone
// goes to (the notifications check each one again when sending).
export async function pageAudienceIds(prisma: PrismaClient, pageId: string): Promise<string[]> {
  return (await getUsersWithPageAccess(prisma, pageId)).map((u) => u.id);
}

export async function pagePeopleNames(prisma: PrismaClient, pageId: string): Promise<Map<string, string>> {
  return new Map((await pagePeople(prisma, pageId)).map((p) => [p.id, p.name]));
}
