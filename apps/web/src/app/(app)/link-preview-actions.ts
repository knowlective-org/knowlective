"use server";

import { requireUser } from "@/lib/auth/session";
import { type LinkPreview, fetchLinkPreview } from "@/lib/link-preview";
import { getLinkPreviewFetchOptions, isLinkPreviewEnabled } from "@/lib/link-preview-settings";

// Whether a pasted URL becomes a link preview card (set in /admin). The
// editor asks once when it opens.
export async function getLinkPreviewEnabled(): Promise<boolean> {
  await requireUser();
  return isLinkPreviewEnabled();
}

// Title, description and image of the page at `url`, for a link preview
// block being added. null if they can't be had, or if previews are turned
// off. The fetch is made by the server, within what the administrators allow
// (lib/link-preview.ts).
export async function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  await requireUser();
  if (typeof url !== "string") return null;
  const options = await getLinkPreviewFetchOptions();
  if (!options) return null;
  return fetchLinkPreview(url, options);
}
