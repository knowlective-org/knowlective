import { prisma } from "@/lib/db";

// Built-in groups are looked up by systemKey (created by migration), never
// by id or display name, so admins can rename them freely.
export const SITE_ADMINS = "site_admins";

// Disabled accounts never count as site admins, even if still in the group.
export async function isSiteAdmin(userId: string): Promise<boolean> {
  const count = await prisma.groupMember.count({
    where: { userId, user: { disabledAt: null }, group: { systemKey: SITE_ADMINS } },
  });
  return count > 0;
}
