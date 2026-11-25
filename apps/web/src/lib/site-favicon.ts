import { prisma } from "@/lib/db";
import { type FaviconType, isFaviconType } from "@/lib/favicon-check";

// The site's favicon in the browser's tab (BrandSettings.favicon), set in the
// admin console's overview: a PNG, ICO or SVG, checked as a knowledge root's
// is (lib/favicon-check.ts). None: the default (public/icon.svg). A knowledge
// root's own favicon still wins on its pages (components/root-favicon.tsx).
// Only the tab's icon: the home-screen and app icons (app/manifest.ts,
// public/apple-icon.png) stay the default ones.
//
// Shown to everyone (the login screen too), so kept as it is, like the logo,
// and served by /api/site-favicon with a CSP that runs nothing.

// The favicon's URL for the page's metadata, without the base path:
// versioned by when it was set (cached for good), or the default icon.
export async function siteFaviconHref(): Promise<{ href: string; type: string }> {
  try {
    const row = await prisma.brandSettings.findUnique({ where: { id: 1 }, select: { faviconType: true, faviconUpdatedAt: true } });
    if (row?.faviconUpdatedAt && isFaviconType(row.faviconType)) {
      return { href: `/api/site-favicon?v=${row.faviconUpdatedAt.getTime()}`, type: row.faviconType };
    }
  } catch {
    // Before setup, or the database is unreachable: the default.
  }
  return { href: "/icon.svg", type: "image/svg+xml" };
}

export async function readSiteFavicon(): Promise<{ type: FaviconType; bytes: Uint8Array } | null> {
  const row = await prisma.brandSettings.findUnique({ where: { id: 1 }, select: { favicon: true, faviconType: true } });
  if (!row?.favicon || !isFaviconType(row.faviconType)) return null;
  return { type: row.faviconType, bytes: row.favicon };
}

// Sets the favicon (checked already), or clears it (null).
export async function saveSiteFavicon(favicon: { type: FaviconType; bytes: Uint8Array } | null): Promise<void> {
  const data = favicon
    ? { favicon: Uint8Array.from(favicon.bytes), faviconType: favicon.type, faviconUpdatedAt: new Date() }
    : { favicon: null, faviconType: null, faviconUpdatedAt: null };
  await prisma.brandSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}
