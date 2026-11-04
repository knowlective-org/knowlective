// A person's own view of a child page table: their filters and sort, saved
// to their account (TableViewPref; Server Actions loadTableView /
// saveTableView in child-pages-actions.ts) and applied in the browser.
// Shared by the block (browser) and the Server Actions — keep dependency-free.
//
// The view comes back from the client, so normalizeView() checks it before
// it's stored.

// One condition per column: the row must match every condition.
//   text   — the cell contains the words (title, text columns)
//   values — the cell is one of these (select options, users; "" = empty)
//   dates  — the cell's date is within from..to (YYYY-MM-DD, either may be "")
export type FilterCondition =
  | { kind: "text"; q: string }
  | { kind: "values"; ids: string[] }
  | { kind: "dates"; from: string; to: string };

export type TableView = {
  // "<key>:asc" / "<key>:desc", "" for creation order; null to follow the
  // table's own sort (the one set for everyone).
  sort: string | null;
  // By column key (built-in names, column ids, or "title").
  filters: Record<string, FilterCondition>;
};

export const EMPTY_VIEW: TableView = { sort: null, filters: {} };

const MAX_FILTERS = 40;
const MAX_QUERY_LENGTH = 200;
const MAX_VALUES = 100;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^(\d{4}-\d{2}-\d{2})?$/;

export function isEmptyView(view: TableView): boolean {
  return view.sort === null && Object.keys(view.filters).length === 0;
}

// A clean copy of a view sent by the client, or null if it isn't one.
// Conditions that would match everything (no words, no values, no dates) are
// dropped.
export function normalizeView(raw: unknown): TableView | null {
  if (!raw || typeof raw !== "object") return null;
  const { sort, filters } = raw as { sort?: unknown; filters?: unknown };
  if (sort !== null && sort !== undefined && (typeof sort !== "string" || !/^([A-Za-z0-9_-]{1,64}:(asc|desc))?$/.test(sort))) {
    return null;
  }
  if (filters !== undefined && (typeof filters !== "object" || filters === null || Array.isArray(filters))) return null;
  const entries = Object.entries((filters ?? {}) as Record<string, unknown>);
  if (entries.length > MAX_FILTERS) return null;
  const clean: Record<string, FilterCondition> = {};
  for (const [key, value] of entries) {
    if (!KEY.test(key) || !value || typeof value !== "object") return null;
    const c = value as Record<string, unknown>;
    if (c.kind === "text") {
      if (typeof c.q !== "string" || c.q.length > MAX_QUERY_LENGTH) return null;
      if (c.q.trim()) clean[key] = { kind: "text", q: c.q.trim() };
    } else if (c.kind === "values") {
      if (!Array.isArray(c.ids) || c.ids.length > MAX_VALUES) return null;
      if (!c.ids.every((id) => typeof id === "string" && (id === "" || KEY.test(id)))) return null;
      const ids = [...new Set(c.ids as string[])];
      if (ids.length > 0) clean[key] = { kind: "values", ids };
    } else if (c.kind === "dates") {
      if (typeof c.from !== "string" || typeof c.to !== "string" || !DATE.test(c.from) || !DATE.test(c.to)) return null;
      if (c.from || c.to) clean[key] = { kind: "dates", from: c.from, to: c.to };
    } else {
      return null;
    }
  }
  return { sort: typeof sort === "string" ? sort : null, filters: clean };
}

// For "contains": the same characters however they were typed (full-width,
// case).
const fold = (text: string) => text.normalize("NFKC").toLowerCase();

// What a condition is checked against, per kind: the cell's text, its value
// id ("" when empty), or its date (YYYY-MM-DD, "" when empty).
export type CellReader = {
  text(key: string): string;
  value(key: string): string;
  date(key: string): string;
};

export function matchesCondition(condition: FilterCondition, key: string, cell: CellReader): boolean {
  switch (condition.kind) {
    case "text": {
      const text = fold(cell.text(key));
      // Every word, in any order.
      return fold(condition.q)
        .split(/\s+/)
        .filter(Boolean)
        .every((word) => text.includes(word));
    }
    case "values":
      return condition.ids.includes(cell.value(key));
    case "dates": {
      const date = cell.date(key);
      if (!date) return false;
      return (!condition.from || date >= condition.from) && (!condition.to || date <= condition.to);
    }
  }
}

// `known`: the keys of the columns the table has now; a filter on a column
// that's gone (deleted) is ignored rather than hiding every row.
export function matchesFilters(filters: TableView["filters"], known: Set<string>, cell: CellReader): boolean {
  return Object.entries(filters).every(([key, condition]) => !known.has(key) || matchesCondition(condition, key, cell));
}
