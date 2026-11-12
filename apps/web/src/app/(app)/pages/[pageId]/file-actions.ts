"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { type AdoptResult, adoptFiles } from "@/lib/file-copy";

// The editor of someone who can edit the page, with attachments in it that
// were uploaded on another page (a block copied from there): makes them the
// page's own (lib/file-copy.ts), so everyone who can open the page can open
// them. Checks the page (EDIT, not locked) and each file's page (open).
// `copy` false: nothing is copied; what would be is in `pending`, for the
// editor to ask about first (the file may have been put here by someone who
// can't open it).
export async function adoptPageFiles(pageId: string, fileIds: string[], copy = false): Promise<AdoptResult> {
  const user = await getCurrentUser();
  if (!user) return { urls: {}, pending: [] };
  return adoptFiles(user.id, pageId, fileIds, copy === true);
}
