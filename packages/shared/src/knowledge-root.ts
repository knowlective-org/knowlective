import type { Prisma, PrismaClient } from "@prisma/client";

// Creates a knowledge root together with its root page. They reference each
// other (KnowledgeRoot.rootPageId ↔ Page.rootId), so this must run inside a
// transaction: create the root, then its page, then link them.
export async function createKnowledgeRoot(
  tx: Prisma.TransactionClient,
  // ownerId: a personal root (see ensurePersonalRoot).
  input: { title: string; createdById: string; ownerId?: string },
): Promise<{ rootId: string; rootPageId: string }> {
  const root = await tx.knowledgeRoot.create({ data: { ownerId: input.ownerId }, select: { id: true } });
  const page = await tx.page.create({
    data: { title: input.title, rootId: root.id, parentId: null, createdById: input.createdById },
    select: { id: true },
  });
  await tx.knowledgeRoot.update({ where: { id: root.id }, data: { rootPageId: page.id } });
  return { rootId: root.id, rootPageId: page.id };
}

// Gives a person's account its personal knowledge root, if it hasn't one
// (safe to call again). Every person has exactly one: made when the account
// is, and for older accounts when the server starts. Accounts that aren't a
// person (planned: AI / RPA) must not get one — don't call this for them.
// `title`: what it starts with (in the person's language); they can rename it.
export async function ensurePersonalRoot(
  tx: Prisma.TransactionClient,
  userId: string,
  title: string,
): Promise<{ rootId: string; rootPageId: string } | null> {
  const existing = await tx.knowledgeRoot.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (existing) return null;
  return createKnowledgeRoot(tx, { title, createdById: userId, ownerId: userId });
}

// Personal roots for the accounts that don't have one yet (accounts made
// before personal roots existed). Run when the server starts. Returns how
// many were made.
export async function ensurePersonalRoots(prisma: PrismaClient, title: string): Promise<number> {
  const users = await prisma.user.findMany({ where: { personalRoot: null }, select: { id: true } });
  let made = 0;
  for (const user of users) {
    if (await prisma.$transaction((tx) => ensurePersonalRoot(tx, user.id, title))) made++;
  }
  return made;
}
