"use server";

import { requireUser } from "@/lib/auth/session";
import { type LinkPreview, fetchLinkPreview } from "@/lib/link-preview";
import { getLinkPreviewFetchOptions, isLinkPreviewEnabled } from "@/lib/link-preview-settings";
import { findAccessiblePage } from "@/lib/auth/pages";
import { shortcutTarget } from "@/lib/shortcuts";
import { getPublicUrl } from "@/lib/site-url";
import { getRequestOrigin } from "@/lib/request";
import { sameSitePath } from "@/lib/same-site-link";
import { BASE_PATH } from "@/lib/base-path";

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

// The title for a URL pasted into text, which then reads as that title
// (collaborative-editor.tsx). A page of this site: its title, if the viewer
// can open it (a shortcut: its page's). Another site: the title its page
// gives, fetched as for a link preview (so only while previews are on, and
// within what the administrators allow). null when there's none to be had.
export async function loadLinkTitle(url: string): Promise<string | null> {
  const user = await requireUser();
  if (typeof url !== "string" || url.length > 2048) return null;
  const pageId = await sitePageId(url);
  if (pageId) {
    const page = await findAccessiblePage(user.id, pageId);
    if (!page) return null;
    if (page.kind !== "SHORTCUT") return page.title.trim() || null;
    const target = await shortcutTarget(user.id, page.shortcutTargetId);
    const targetPage = target ? await findAccessiblePage(user.id, target) : null;
    return targetPage?.title.trim() || null;
  }
  const options = await getLinkPreviewFetchOptions();
  if (!options) return null;
  const preview = await fetchLinkPreview(url, options);
  return preview?.title?.trim() || null;
}

// The page id in a URL of a page of this site (its public URL's origin, or
// the one it's being used at), else null.
async function sitePageId(url: string): Promise<string | null> {
  for (const origin of new Set([new URL(await getPublicUrl()).origin, await getRequestOrigin()])) {
    const path = sameSitePath(url, origin, BASE_PATH);
    const m = path ? /^\/pages\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(path) : null;
    if (m) return m[1];
  }
  return null;
}
