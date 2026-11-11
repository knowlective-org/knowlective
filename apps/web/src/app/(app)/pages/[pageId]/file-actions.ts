"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { type AdoptedFiles, adoptFiles } from "@/lib/file-copy";

// The editor of someone who can edit the page, with attachments in it that
// were uploaded on another page (a block copied from there): makes them the
// page's own (lib/file-copy.ts), so everyone who can open the page can open
// them. Checks the page (EDIT, not locked) and each file's page (open).
export async function adoptPageFiles(pageId: string, fileIds: string[]): Promise<AdoptedFiles> {
  const user = await getCurrentUser();
  if (!user) return {};
  return adoptFiles(user.id, pageId, fileIds);
}
