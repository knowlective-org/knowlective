import { type SiteRole } from "shared";
// The admin console isn't covered by the network caps (lib/page-access.ts).
import { getVisibleTrees } from "shared";
import { prisma } from "@/lib/db";

// Which groups an admin-console user may see and edit (members, name,
// deletion) or hand out in invitations.
//
// - SITE_ADMIN (and the master password login): every group.
// - CONTENT_MANAGER: only groups whose every grant sits on a page it can
//   MANAGE. Otherwise a content manager could join a group to read pages it
//   was never given. Groups with no grants yet are allowed.
export type GroupActor = { userId: string | null; role: SiteRole };

export async function manageableGroupIds(actor: GroupActor): Promise<"all" | Set<string>> {
  if (actor.role === "SITE_ADMIN" || actor.userId === null) return "all";

  const [groups, trees] = await Promise.all([
    prisma.group.findMany({ select: { id: true, grants: { select: { pageId: true } } } }),
    getVisibleTrees(prisma, actor.userId),
  ]);
  const managed = new Set(trees.flatMap((t) => t.pages.filter((p) => p.access === "MANAGE").map((p) => p.id)));
  return new Set(groups.filter((g) => g.grants.every((grant) => managed.has(grant.pageId))).map((g) => g.id));
}

export async function canManageGroup(actor: GroupActor, groupId: string): Promise<boolean> {
  const allowed = await manageableGroupIds(actor);
  return allowed === "all" || allowed.has(groupId);
}
