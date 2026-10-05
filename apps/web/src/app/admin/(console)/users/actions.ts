"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";

// Disabling keeps the account and its knowledge root/group memberships, so
// re-enabling restores access as it was. It takes effect immediately: every
// session is deleted, and getCurrentUser / isSiteAdmin / the collab server
// all refuse disabled accounts on their own as well.
export async function disableUser(formData: FormData): Promise<void> {
  const { session } = await requireAdmin();
  const userId = formData.get("userId");
  if (typeof userId !== "string") return;
  // Disabling yourself would lock you out mid-change.
  if (userId === session.userId) return;

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: userId, disabledAt: null },
      data: { disabledAt: new Date() },
    }),
    prisma.userSession.deleteMany({ where: { userId } }),
    prisma.adminSession.deleteMany({ where: { userId } }),
  ]);
  revalidatePath("/admin", "layout");
}

export async function enableUser(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = formData.get("userId");
  if (typeof userId !== "string") return;
  await prisma.user.updateMany({ where: { id: userId }, data: { disabledAt: null } });
  revalidatePath("/admin", "layout");
}
