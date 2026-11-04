"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { markAllRead } from "@/lib/notifications";

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await markAllRead(user.id);
  revalidatePath("/notifications");
}
