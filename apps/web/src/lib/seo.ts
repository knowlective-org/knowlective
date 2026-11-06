import * as Y from "yjs";
import { prisma } from "@/lib/db";
import { currentPageState } from "@/lib/api/page-content";
import { getVisibleTrees } from "@/lib/page-access";
import { documentText } from "@/lib/search-index";

// What search engines get of a site that lets them in (InstanceConfig.
// searchEnginesAllowed; until then every response says noindex,
// server/robots.ts): robots.txt pointing to the sitemap, a sitemap of the
// public pages (those someone not logged in can open), and for each public
// page a description, its canonical URL, Open Graph / Twitter card tags and
// structured data (app/(app)/pages/[pageId]/page.tsx). Only public pages are
// ever described or listed: nothing here is shown that a visitor couldn't
// read on the page itself, and no one's name.

const DESCRIPTION_LENGTH = 160;
// A sitemap holds at most 50,000 URLs.
const MAX_SITEMAP_URLS = 50_000;

export async function searchEnginesAllowed(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { searchEnginesAllowed: true } });
  return config?.searchEnginesAllowed ?? false;
}

// The public pages (newest change first), when search engines are allowed.
export async function sitemapPages(): Promise<{ id: string; updatedAt: Date }[]> {
  if (!(await searchEnginesAllowed())) return [];
  // Someone not logged in: the public pages (none unless public pages are allowed).
  const trees = await getVisibleTrees(prisma, null);
  const ids = trees.flatMap((t) => t.pages.map((p) => p.id));
  if (ids.length === 0) return [];
  return prisma.page.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_SITEMAP_URLS,
  });
}

// The start of a page's text, on one line: its description. Call only for a
// public page (the caller checks), as it reads the body.
export async function pageDescription(pageId: string): Promise<string> {
  const state = await currentPageState(pageId);
  if (!state) return "";
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const text = documentText(doc).replace(/\s+/g, " ").trim();
  if (text.length <= DESCRIPTION_LENGTH) return text;
  return `${text.slice(0, DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

// For a <script type="application/ld+json">: JSON that can't end the script
// early ("</script>") or start a comment.
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
