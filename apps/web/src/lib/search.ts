import { getVisibleTrees, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { displayTitle } from "@/lib/page-title";
import {
  normalizeWithMap,
  pageSearchText,
  queryTokens,
  searchKey,
} from "@/lib/search-index";

// Full-text search over the pages a user can open (see lib/search-index.ts
// for the encrypted index). The index only narrows candidates; every result
// is confirmed against the decrypted text, so hash collisions and pages the
// user can't see never show up.

export const MAX_QUERY_LENGTH = 100;
const MAX_CANDIDATES = 300;
const MAX_RESULTS = 50;
const SNIPPET_RADIUS = 40;

export type SnippetPart = { text: string; hit: boolean };

export type SearchResult = {
  id: string;
  title: string;
  // Visible ancestors, root first (hidden ones are left out).
  path: string[];
  // Where it matched: the body (with context), an attachment name, or only the title.
  snippet: SnippetPart[] | null;
  matchedFile: string | null;
  updatedAt: string;
};

// Where all terms occur in `text`, as ranges in the original string.
function findTerms(
  text: string,
  terms: string[],
): { start: number; end: number }[] | null {
  const { chars, origin } = normalizeWithMap(text);
  const ranges: { start: number; end: number }[] = [];
  for (const term of terms) {
    const needle = Array.from(term);
    let found = false;
    for (let i = 0; i + needle.length <= chars.length; i++) {
      if (needle.every((ch, j) => chars[i + j] === ch)) {
        const last = i + needle.length - 1;
        const end = last + 1 < origin.length ? origin[last + 1] : text.length;
        ranges.push({ start: origin[i], end });
        found = true;
      }
    }
    if (!found) return null;
  }
  return ranges.sort((a, b) => a.start - b.start);
}

// The text around the first match, with every match in it marked.
function snippet(
  text: string,
  ranges: { start: number; end: number }[],
): SnippetPart[] {
  const from = Math.max(0, ranges[0].start - SNIPPET_RADIUS);
  const to = Math.min(text.length, ranges[0].end + SNIPPET_RADIUS * 2);
  const parts: SnippetPart[] = [];
  let pos = from;
  for (const r of ranges) {
    if (r.end <= pos || r.start >= to) continue;
    if (r.start > pos)
      parts.push({ text: text.slice(pos, r.start), hit: false });
    parts.push({
      text: text.slice(Math.max(r.start, pos), Math.min(r.end, to)),
      hit: true,
    });
    pos = Math.min(r.end, to);
  }
  if (pos < to) parts.push({ text: text.slice(pos, to), hit: false });
  if (from > 0) parts.unshift({ text: "…", hit: false });
  if (to < text.length) parts.push({ text: "…", hit: false });
  return parts.map((p) => ({ ...p, text: p.text.replace(/\s+/g, " ") }));
}

export async function searchPages(
  userId: string,
  query: string,
): Promise<SearchResult[]> {
  const key = searchKey(await loadDataKey(prisma));
  const { terms, tokens } = queryTokens(key, query.slice(0, MAX_QUERY_LENGTH));
  if (terms.length === 0) return [];

  // Pages the user can open, with their visible ancestors.
  const trees = await getVisibleTrees(prisma, userId);
  const visible = new Map(
    trees.flatMap((t) => t.pages.map((p) => [p.id, p] as const)),
  );
  const pathOf = (id: string) => {
    const path: string[] = [];
    for (
      let p = visible.get(visible.get(id)?.parentId ?? "");
      p;
      p = visible.get(p.parentId ?? "")
    ) {
      path.unshift(displayTitle(p.title));
      if (path.length > 50) break;
    }
    return path;
  };

  const rows = await prisma.$queryRaw<{ pageId: string }[]>`
    SELECT "pageId" FROM "PageSearchIndex"
    WHERE "tokens" @> ${tokens.map(String)}::bigint[]`;
  const candidates = rows
    .map((r) => r.pageId)
    .filter((id) => visible.has(id))
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return [];
  const updated = new Map(
    (
      await prisma.page.findMany({
        where: { id: { in: candidates } },
        select: { id: true, updatedAt: true },
      })
    ).map((p) => [p.id, p.updatedAt]),
  );

  const results: { result: SearchResult; inTitle: boolean }[] = [];
  for (const id of candidates) {
    const text = await pageSearchText(prisma, id);
    if (!text) continue;
    const all = [text.title, text.body, ...text.files].join("\n");
    if (!findTerms(all, terms)) continue; // index false positive
    // Snippet from the body, around the terms found there (a term may
    // instead be in the title or an attachment name).
    const bodyTerms = terms.filter((t) => findTerms(text.body, [t]));
    const bodyRanges =
      bodyTerms.length > 0 ? findTerms(text.body, bodyTerms) : null;
    const file = text.files.find((f) => terms.some((t) => findTerms(f, [t])));
    results.push({
      inTitle: terms.every((t) => findTerms(text.title, [t])),
      result: {
        id,
        title: text.title,
        path: pathOf(id),
        snippet: bodyRanges ? snippet(text.body, bodyRanges) : null,
        matchedFile: bodyRanges ? null : (file ?? null),
        updatedAt: (updated.get(id) ?? new Date(0)).toISOString(),
      },
    });
  }
  // Title matches first, then the most recently updated.
  results.sort(
    (a, b) =>
      Number(b.inTitle) - Number(a.inTitle) ||
      b.result.updatedAt.localeCompare(a.result.updatedAt),
  );
  return results.slice(0, MAX_RESULTS).map((r) => r.result);
}
