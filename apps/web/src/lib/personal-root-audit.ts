import { auditTranslator } from "@/i18n/audit";
import { recordAudit, userLabel } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { displayName, withEmail } from "@/lib/emails";

// Auditors viewing someone's personal knowledge root (allowed by a site admin:
// InstanceConfig.auditorsSeePersonalRoots, packages/shared/src/permissions.ts).
// Every page they open there is recorded in the audit log — whose root and
// which page (its id: not its title, which site admins couldn't otherwise
// see) — and the owner is told on their root page that auditors may look.

export async function auditorsSeePersonalRoots(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { auditorsSeePersonalRoots: true } });
  return config?.auditorsSeePersonalRoots ?? false;
}

// A page reloaded or returned to (RefreshOnReturn) within this time isn't
// recorded again.
const AGAIN_AFTER_MS = 10 * 60 * 1000;
const recorded = new Map<string, number>();

// Records `viewer` opening `page` (from findAccessiblePage) if it's in
// someone else's personal root; returns that someone's name for the screen,
// or null.
export async function noteAuditorView(
  viewer: { id: string; name: string | null; email: string },
  page: { id: string; root: { ownerId: string | null } },
  where: "page" | "history",
): Promise<string | null> {
  const ownerId = page.root.ownerId;
  if (!ownerId || ownerId === viewer.id) return null;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true, emailEnc: true } });
  const ownerName = owner ? await displayName(owner) : "";
  const key = `${viewer.id}:${page.id}:${where}`;
  const now = Date.now();
  if ((recorded.get(key) ?? 0) + AGAIN_AFTER_MS < now) {
    recorded.set(key, now);
    for (const [k, at] of recorded) if (at + AGAIN_AFTER_MS < now) recorded.delete(k);
    const audit = await auditTranslator();
    const ownerLabel = owner?.emailEnc ? userLabel(await withEmail({ ...owner, emailEnc: owner.emailEnc })) : ownerName;
    await recordAudit(
      { userId: viewer.id, label: userLabel(viewer) },
      "personal-page.view",
      audit("audit.personalPageView", { owner: ownerLabel, pageId: page.id, where }),
      { pageId: page.id, ownerId, where },
    );
  }
  return ownerName;
}
