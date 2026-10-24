import { loadDataKey, type VisiblePage } from "shared";
import { getVisibleTrees } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { getDisplayTitle } from "@/i18n/display-title";
import {
  normalizeWithMap,
  pageSearchText,
  queryTokens,
  searchKey,
  type PageSearchText,
} from "@/lib/search-index";
import { semanticSearch, semanticSearchStatus, type SemanticHit } from "@/lib/semantic-bridge";
import { type SearchMode, type SearchModeReason, chooseSearchMode } from "@/lib/search-mode";

// Search over the pages a user can open, one box for two kinds of search
// (lib/search-mode.ts picks one from the query; the screen can ask for the
// other):
//
// - keyword: full-text search (see lib/search-index.ts for the encrypted
//   index). The index only narrows candidates; every result is confirmed
//   against the decrypted text, so hash collisions and pages the user can't
//   see never show up.
// - semantic: the keyword results merged with the pages whose passages are
//   closest in meaning (lib/semantic-bridge.ts), by reciprocal rank fusion.
//   Only pages the user can open are searched.

export const MAX_QUERY_LENGTH = 100;
const MAX_CANDIDATES = 300;
const MAX_RESULTS = 50;
const SNIPPET_RADIUS = 40;
// Semantic search: passages to fetch, and how close a page must be to be
// shown — within SCORE_WINDOW of the best one, and at least MIN_SCORE
// (cosine similarity; e5 gives unrelated text up to about 0.82, related
// passages 0.84 and up).
const SEMANTIC_PASSAGES = 100;
const MIN_SCORE = 0.83;
const SCORE_WINDOW = 0.04;
// Reciprocal rank fusion: 1 / (RRF_K + rank) from each list.
const RRF_K = 60;

export type SnippetPart = { text: string; hit: boolean };

export type SearchResult = {
  id: string;
  title: string;
  // Visible ancestors, root first (hidden ones are left out).
  path: string[];
  // Where it matched: the body (with context), an attachment (its name, and
  // the passage when it's in the file's text), or only the title.
  snippet: SnippetPart[] | null;
  matchedFile: { name: string; snippet: SnippetPart[] | null } | null;
  // Found by meaning only (no matching words): the snippet is the passage.
  bySemantic: boolean;
  updatedAt: string;
};

export type SearchOutcome = {
  results: SearchResult[];
  mode: SearchMode;
  // Why this mode (when it was chosen from the query, not asked for).
  reason: SearchModeReason | null;
  // Semantic search: available, being prepared, or not set up.
  semantic: "ready" | "loading" | "off";
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

// A passage found by meaning, cut to snippet length.
function passageSnippet(body: string, hit: SemanticHit): SnippetPart[] | null {
  if (hit.start < 0) return null;
  const length = SNIPPET_RADIUS * 3;
  const text = body.slice(hit.start, Math.min(hit.end, hit.start + length)).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const parts: SnippetPart[] = [{ text, hit: false }];
  if (hit.start > 0) parts.unshift({ text: "…", hit: false });
  if (hit.start + length < body.length) parts.push({ text: "…", hit: false });
  return parts;
}

export async function searchPages(
  userId: string,
  query: string,
  requested?: SearchMode,
): Promise<SearchOutcome> {
  const q = query.slice(0, MAX_QUERY_LENGTH);
  const choice = chooseSearchMode(q);
  const status = semanticSearchStatus();
  // Semantic search when asked for or chosen, and available.
  const mode: SearchMode = status === "ready" ? (requested ?? choice.mode) : "keyword";
  const outcome = (results: SearchResult[]): SearchOutcome => ({
    results,
    mode,
    reason: requested ? null : choice.reason,
    semantic: status,
  });

  // Pages the user can open, with their visible ancestors.
  const trees = await getVisibleTrees(prisma, userId);
  const visible = new Map(
    trees.flatMap((t) => t.pages.map((p) => [p.id, p] as const)),
  );
  const ctx = { visible, texts: new Map<string, PageSearchText | null>(), displayTitle: await getDisplayTitle() };

  const keyword = await keywordSearch(q, ctx);
  if (mode === "keyword") return outcome(keyword);

  const hits = (await semanticSearch(q, [...visible.keys()], SEMANTIC_PASSAGES)) ?? [];
  // The best passage of each page, close enough to the best page overall.
  const best = new Map<string, SemanticHit>();
  for (const hit of hits) if (!best.has(hit.pageId)) best.set(hit.pageId, hit);
  const top = hits[0]?.score ?? 0;
  const semanticPages = [...best.values()].filter((h) => h.score >= MIN_SCORE && h.score >= top - SCORE_WINDOW);

  // Reciprocal rank fusion of the two rankings.
  const scores = new Map<string, number>();
  keyword.forEach((r, i) => scores.set(r.id, 1 / (RRF_K + i + 1)));
  semanticPages.forEach((h, i) => scores.set(h.pageId, (scores.get(h.pageId) ?? 0) + 1 / (RRF_K + i + 1)));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_RESULTS);

  const byKeyword = new Map(keyword.map((r) => [r.id, r]));
  const updated = await updatedTimes(ranked.map(([id]) => id).filter((id) => !byKeyword.has(id)));
  const results: SearchResult[] = [];
  for (const [id] of ranked) {
    const found = byKeyword.get(id);
    if (found) {
      results.push(found);
      continue;
    }
    const text = await textOf(ctx, id);
    if (!text) continue;
    results.push({
      id,
      title: text.title,
      path: pathOf(visible, id, ctx.displayTitle),
      snippet: passageSnippet(text.body, best.get(id)!),
      matchedFile: null,
      bySemantic: true,
      updatedAt: (updated.get(id) ?? new Date(0)).toISOString(),
    });
  }
  return outcome(results);
}

type SearchContext = {
  visible: Map<string, VisiblePage>;
  // Decrypted page texts, each read once per search.
  texts: Map<string, PageSearchText | null>;
  // For the path above each result, in the searcher's language.
  displayTitle: (title: string) => string;
};

async function textOf(ctx: SearchContext, id: string): Promise<PageSearchText | null> {
  if (!ctx.texts.has(id)) ctx.texts.set(id, await pageSearchText(prisma, id));
  return ctx.texts.get(id)!;
}

function pathOf(visible: Map<string, VisiblePage>, id: string, displayTitle: (title: string) => string): string[] {
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
}

async function updatedTimes(ids: string[]): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map();
  const pages = await prisma.page.findMany({
    where: { id: { in: ids } },
    select: { id: true, updatedAt: true },
  });
  return new Map(pages.map((p) => [p.id, p.updatedAt]));
}

// Pages containing every word of the query.

// The attachment a query matched in, when not in the body: in its text (with
// the passage) first, else in its name.
function matchedFile(text: PageSearchText, terms: string[]): SearchResult["matchedFile"] {
  for (const f of text.fileTexts) {
    const ranges = terms.every((t) => findTerms(f.text, [t])) ? findTerms(f.text, terms) : null;
    if (ranges) return { name: f.name, snippet: snippet(f.text, ranges) };
  }
  const named = text.files.find((f) => terms.some((t) => findTerms(f, [t])));
  if (named) return { name: named, snippet: null };
  const partly = text.fileTexts.find((f) => terms.some((t) => findTerms(f.text, [t])));
  return partly ? { name: partly.name, snippet: snippet(partly.text, findTerms(partly.text, terms.filter((t) => findTerms(partly.text, [t])))!) } : null;
}

async function keywordSearch(query: string, ctx: SearchContext): Promise<SearchResult[]> {
  const key = searchKey(await loadDataKey(prisma));
  const { terms, tokens } = queryTokens(key, query);
  if (terms.length === 0) return [];

  const rows = await prisma.$queryRaw<{ pageId: string }[]>`
    SELECT "pageId" FROM "PageSearchIndex"
    WHERE "tokens" @> ${tokens.map(String)}::bigint[]`;
  const candidates = rows
    .map((r) => r.pageId)
    .filter((id) => ctx.visible.has(id))
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return [];
  const updated = await updatedTimes(candidates);

  const results: { result: SearchResult; inTitle: boolean }[] = [];
  for (const id of candidates) {
    const text = await textOf(ctx, id);
    if (!text) continue;
    const all = [text.title, text.body, ...text.files, ...text.fileTexts.map((f) => f.text)].join("\n");
    if (!findTerms(all, terms)) continue; // index false positive
    // Snippet from the body, around the terms found there (a term may
    // instead be in the title or an attachment name).
    const bodyTerms = terms.filter((t) => findTerms(text.body, [t]));
    const bodyRanges =
      bodyTerms.length > 0 ? findTerms(text.body, bodyTerms) : null;
    const file = bodyRanges ? null : matchedFile(text, terms);
    results.push({
      inTitle: terms.every((t) => findTerms(text.title, [t])),
      result: {
        id,
        title: text.title,
        path: pathOf(ctx.visible, id, ctx.displayTitle),
        snippet: bodyRanges ? snippet(text.body, bodyRanges) : null,
        matchedFile: file,
        bySemantic: false,
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
