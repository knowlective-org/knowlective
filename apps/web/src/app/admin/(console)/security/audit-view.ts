import { atLeast, getPageAccess, getTreeWithAccess } from "shared";
import { auditPageIds } from "@/lib/audit-pages";
import { prisma } from "@/lib/db";

type Log = { action: string; summary: string; detail: unknown; redacted?: string };

// What the viewer (null: the master password login) is shown of each entry:
// an entry naming pages (lib/audit-pages.ts) as it is only if they can open
// every one of them (as in the app: a site admin can't open pages without
// a grant, and the master password login only public ones). Otherwise the
// summary with the titles hidden, recorded with it; entries from before that
// was recorded have none, and say only that they're hidden (`hidden`).
export async function auditSummaries<T extends Log>(
  logs: T[],
  viewerId: string | null,
): Promise<(T & { hidden: boolean })[]> {
  const seen = new Map<string, Promise<boolean>>();
  const trees = new Map<string, ReturnType<typeof getTreeWithAccess>>();
  // A page in the trash (page.delete) opens for nobody: it counts as open
  // for those who could open it were it not deleted. Not in a deleted
  // knowledge root (no grants), nor for the master password login.
  const couldOpen = async (pageId: string) => {
    if (viewerId === null) return false;
    const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, deletedAt: true } });
    if (!page?.deletedAt) return false;
    let tree = trees.get(page.rootId);
    if (!tree) {
      tree = getTreeWithAccess(prisma, viewerId, page.rootId);
      trees.set(page.rootId, tree);
    }
    return atLeast((await tree).access.get(pageId) ?? null, "VIEW");
  };
  const canOpen = (pageId: string) => {
    let open = seen.get(pageId);
    if (!open) {
      open = getPageAccess(prisma, viewerId, pageId).then((access) => access !== null || couldOpen(pageId));
      seen.set(pageId, open);
    }
    return open;
  };
  return Promise.all(
    logs.map(async (log) => {
      const ids = auditPageIds(log.action, log.detail);
      const shown = !ids || (await Promise.all(ids.map(canOpen))).every(Boolean);
      if (shown) return { ...log, hidden: false };
      return log.redacted ? { ...log, summary: log.redacted, hidden: false } : { ...log, summary: "", hidden: true };
    }),
  );
}
