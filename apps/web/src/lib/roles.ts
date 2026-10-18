import type { SiteRole } from "shared";
import { prisma } from "@/lib/db";

// Site-wide roles (User.siteRole). Page access never comes from a role — only
// from group grants — so even SITE_ADMIN can't read pages it isn't granted.

export const SITE_ROLES: SiteRole[] = ["SITE_ADMIN", "CONTENT_MANAGER", "USER"];

// Roles that may sign in to /admin (with TOTP).
export const ADMIN_CONSOLE_ROLES: SiteRole[] = ["SITE_ADMIN", "CONTENT_MANAGER"];

// Who can grant which role: a content manager can only invite at its own
// level or below, so it can never create a site admin.
export function invitableRoles(actorRole: SiteRole): SiteRole[] {
  return actorRole === "SITE_ADMIN" ? SITE_ROLES : ["CONTENT_MANAGER", "USER"];
}

// The user's role if it may use /admin right now (enabled, admin-capable role).
export async function getAdminConsoleRole(userId: string): Promise<SiteRole | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { siteRole: true, disabledAt: true },
  });
  if (!user || user.disabledAt || !ADMIN_CONSOLE_ROLES.includes(user.siteRole)) return null;
  return user.siteRole;
}

// Enabled site admins other than `exceptUserId`; used to refuse demoting or
// disabling the last one.
export async function countOtherActiveSiteAdmins(exceptUserId: string): Promise<number> {
  return prisma.user.count({
    where: { siteRole: "SITE_ADMIN", disabledAt: null, NOT: { id: exceptUserId } },
  });
}
