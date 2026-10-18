import { getPageAccess, getVisibleTrees } from "shared";
import { prisma } from "@/lib/db";
import { displayTitle } from "@/lib/page-title";
import { publicPageIds, publicPageOptions } from "@/lib/public-pages";

// The top page (InstanceConfig.landingPageId), set in /admin (概要): the page
// "/" opens for someone with nowhere else to go. One setting for everyone:
// - logged in: when there's no last opened page (User.lastPageId), which is
//   the first visit after signing up;
// - not logged in: every time (no history is kept for them).
// Each sees it only if they can open it, so a page that isn't public is never
// shown to someone not logged in (they get the login screen) and someone
// without access to it gets the first page they can see.

// The top page for `userId` (null: not logged in), if they can open it.
export async function landingPageFor(userId: string | null): Promise<string | null> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { landingPageId: true } });
  const id = config?.landingPageId;
  return id && (await getPageAccess(prisma, userId, id)) ? id : null;
}

export type LandingPageOption = { id: string; label: string; public: boolean };

// The pages a site admin can pick: those they can open themselves (not their
// personal root, which only they could see), and the public ones. Each is
// named with ancestors the admin can see (public ones: public ancestors), so
// no title is shown to an admin who can't open the page. Signed in with the
// master password (no user): the public pages only.
export async function landingPageOptions(adminUserId: string | null): Promise<LandingPageOption[]> {
  const [publicIds, publicOptions, trees] = await Promise.all([
    publicPageIds(),
    publicPageOptions(),
    adminUserId ? getVisibleTrees(prisma, adminUserId) : Promise.resolve([]),
  ]);
  const isPublic = new Set(publicIds);
  const options = new Map<string, LandingPageOption>();
  for (const tree of trees) {
    if (tree.personal) continue;
    const byId = new Map(tree.pages.map((p) => [p.id, p]));
    for (const page of tree.pages) {
      const names: string[] = [];
      for (let p: typeof page | undefined = page; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
        names.unshift(displayTitle(p.title));
      }
      options.set(page.id, { id: page.id, label: names.join(" / "), public: isPublic.has(page.id) });
    }
  }
  for (const o of publicOptions) if (!options.has(o.id)) options.set(o.id, { ...o, public: true });
  return [...options.values()];
}
