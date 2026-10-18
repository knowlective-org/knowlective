// Which search a query gets, from the query alone (one search box for both).
//
// - keyword: the words as they are (lib/search-index.ts). For what has to
//   match exactly: quoted text, codes and names with digits or symbols
//   (model numbers, URLs, file names, addresses), and short queries (a word or two).
// - semantic: pages close in meaning too (lib/semantic-bridge.ts), merged
//   with the keyword results. For sentence-like queries ("how to apply for paid leave",
//   "how do I restore a backup"), where the page may use other words.
//
// The search screen says which one it used (and why: search.reasons) and
// offers the other.

export type SearchMode = "keyword" | "semantic";

export type SearchModeReason = "quoted" | "code" | "short" | "sentence";

export type SearchModeChoice = { mode: SearchMode; reason: SearchModeReason };

const QUOTED = /^(["“『「]).+(["”』」])$/;
// A term with a digit and a letter, or with symbols that join a name
// (ABC-123, v2.1, foo_bar, user@example.com, https://…, report.pdf).
const CODE_LIKE = /(?=.*[0-9])(?=.*[A-Za-z])|[A-Za-z0-9][/@#:_.\\-][A-Za-z0-9]/;
const ASCII = /^[\x20-\x7e]+$/;
// Up to this many characters (Japanese and the like), or words (ASCII), a
// query is taken as words to find.
const SHORT_CHARS = 4;
const SHORT_WORDS = 2;

export function chooseSearchMode(query: string): SearchModeChoice {
  const q = query.normalize("NFKC").trim();
  if (QUOTED.test(q)) {
    return { mode: "keyword", reason: "quoted" };
  }
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.some((t) => CODE_LIKE.test(t))) {
    return { mode: "keyword", reason: "code" };
  }
  const short = ASCII.test(q) ? terms.length <= SHORT_WORDS : q.replace(/\s/g, "").length <= SHORT_CHARS;
  if (short) {
    return { mode: "keyword", reason: "short" };
  }
  return { mode: "semantic", reason: "sentence" };
}

export function isSearchMode(value: unknown): value is SearchMode {
  return value === "keyword" || value === "semantic";
}
