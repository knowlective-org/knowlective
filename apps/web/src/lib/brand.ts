import type { BrandMode } from "shared";
import { prisma } from "@/lib/db";
import { DEFAULT_BRAND_NAME } from "./brand-defaults";

// What the top left of the sidebars shows (BrandSettings): the site's name in
// text (Newsreader 600), or an SVG logo set in the admin console (overview).
//
// The logo is uploaded by a site admin, but SVG can carry scripts, so it's
// held to two guards: checkLogoSvg() refuses anything active or external when
// it's uploaded, and /api/brand-logo serves it with a CSP that runs nothing
// (it's shown with <img>, which never runs scripts anyway).

export { DEFAULT_BRAND_NAME } from "./brand-defaults";
export const MAX_BRAND_NAME_LENGTH = 40;
export { MAX_LOGO_BYTES } from "./logo-svg";

// For pages: the logo by its URL (versioned, cached for good), not its text.
export type Brand = { mode: BrandMode; name: string; logoVersion: string | null };

export async function getBrand(): Promise<Brand> {
  try {
    const row = await prisma.brandSettings.findUnique({
      where: { id: 1 },
      select: { mode: true, name: true, updatedAt: true, logoSvg: true },
    });
    if (!row) return { mode: "TEXT", name: DEFAULT_BRAND_NAME, logoVersion: null };
    const logoVersion = row.logoSvg ? String(row.updatedAt.getTime()) : null;
    return { mode: row.mode === "IMAGE" && logoVersion ? "IMAGE" : "TEXT", name: row.name, logoVersion };
  } catch {
    // Before setup, or the database is unreachable: the login screen still renders.
    return { mode: "TEXT", name: DEFAULT_BRAND_NAME, logoVersion: null };
  }
}

export async function getBrandLogo(): Promise<string | null> {
  const row = await prisma.brandSettings.findUnique({ where: { id: 1 }, select: { logoSvg: true } });
  return row?.logoSvg ?? null;
}

export async function saveBrand(input: { mode: BrandMode; name: string; logoSvg?: string }): Promise<void> {
  const data = { mode: input.mode, name: input.name, ...(input.logoSvg !== undefined && { logoSvg: input.logoSvg }) };
  await prisma.brandSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

export { type LogoError, checkLogoSvg } from "./logo-svg";
