import { prisma } from "@/lib/db";
import { rootName, rootNameSelect } from "@/lib/knowledge-roots";

// The page plus the viewer's role in its knowledge root, or null if the page
// doesn't exist, is deleted, or the user isn't a member of its knowledge root.
// Callers should treat null as "not found" so page ids can't be probed.
export async function findAccessiblePage(userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      root: { members: { some: { userId } } },
    },
    select: {
      id: true,
      title: true,
      root: {
        select: {
          id: true,
          rootPageId: true,
          ...rootNameSelect,
          members: { where: { userId }, select: { role: true } },
        },
      },
    },
  });
  if (!page) return null;
  return {
    id: page.id,
    title: page.title,
    isRootPage: page.root.rootPageId === page.id,
    root: { id: page.root.id, name: rootName(page.root), rootPageId: page.root.rootPageId },
    role: page.root.members[0].role,
  };
}
