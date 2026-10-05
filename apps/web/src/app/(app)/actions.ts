"use server";

import { redirect } from "next/navigation";
import { createCollabToken } from "shared";
import { findAccessiblePage } from "@/lib/auth/pages";
import { endUserSession, requireUser } from "@/lib/auth/session";

export async function logout(): Promise<void> {
  await endUserSession();
  redirect("/login");
}

// Called by the editor each time it (re)connects to the collab server, so the
// short-lived token is always fresh and membership is re-checked.
export async function getCollabToken(pageId: string): Promise<string> {
  const user = await requireUser();
  if (typeof pageId !== "string" || !(await findAccessiblePage(user.id, pageId))) {
    throw new Error("Page not found");
  }
  return createCollabToken(user.id, pageId);
}
