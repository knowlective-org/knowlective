import type { Prisma } from "@prisma/client";

// Creates a knowledge root together with its root page. They reference each
// other (KnowledgeRoot.rootPageId ↔ Page.rootId), so this must run inside a
// transaction: create the root, then its page, then link them.
export async function createKnowledgeRoot(
  tx: Prisma.TransactionClient,
  input: { title: string; createdById: string },
): Promise<{ rootId: string; rootPageId: string }> {
  const root = await tx.knowledgeRoot.create({ data: {}, select: { id: true } });
  const page = await tx.page.create({
    data: { title: input.title, rootId: root.id, parentId: null, createdById: input.createdById },
    select: { id: true },
  });
  await tx.knowledgeRoot.update({ where: { id: root.id }, data: { rootPageId: page.id } });
  return { rootId: root.id, rootPageId: page.id };
}
