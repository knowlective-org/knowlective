import { prisma } from "@/lib/db";

// The page plus the viewer's role in its workspace, or null if the page
// doesn't exist, is deleted, or the user isn't a member of its workspace.
// Callers should treat null as "not found" so page ids can't be probed.
export async function findAccessiblePage(userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      workspace: { members: { some: { userId } } },
    },
    select: {
      id: true,
      title: true,
      workspace: { select: { id: true, name: true, members: { where: { userId }, select: { role: true } } } },
    },
  });
  if (!page) return null;
  return { id: page.id, title: page.title, workspace: page.workspace, role: page.workspace.members[0].role };
}
