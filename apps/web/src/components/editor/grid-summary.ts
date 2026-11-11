// The extended table's summary row: what each column shows below the table
// (a sum, an average, a count, …) worked out from the text of its cells. Kept
// as the table's `summary` prop (JSON, one entry per column; "" = no summary
// row). Dependency-free: used by the editor (grid-table-block.ts), export
// (markdown-export.ts) and the unit tests (test/grid-summary.test.ts).
//
// Conditions (COUNTIF, SUMIF) are written as in a spreadsheet: "完了", ">=10",
// "<>保留", "<5", "=" (empty), "<>" (not empty); "*" and "?" are wildcards in
// text. A number compares as a number with cells holding numbers.

export const SUMMARY_FUNCTIONS = ["sum", "average", "count", "counta", "min", "max", "countif", "sumif"] as const;
export type SummaryFunction = (typeof SUMMARY_FUNCTIONS)[number];

// `criteria`: COUNTIF / SUMIF's condition. `range`: SUMIF's column whose
// cells the condition is tested on (this column's cells are added up).
export type SummarySpec = { fn: SummaryFunction; criteria?: string; range?: number } | null;

export const MAX_CRITERIA_LENGTH = 100;

// The summary row's specs, one per column, or null when the table has none.
export function parseSummary(value: unknown, columns: number): SummarySpec[] | null {
  if (typeof value !== "string" || value === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return Array.from({ length: columns }, (_, i) => cleanSpec(parsed[i], columns));
}

// What's in the shared document is checked before use.
function cleanSpec(value: unknown, columns: number): SummarySpec {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!(SUMMARY_FUNCTIONS as readonly unknown[]).includes(v.fn)) return null;
  const fn = v.fn as SummaryFunction;
  const spec: NonNullable<SummarySpec> = { fn };
  if (fn === "countif" || fn === "sumif") spec.criteria = typeof v.criteria === "string" ? v.criteria.slice(0, MAX_CRITERIA_LENGTH) : "";
  if (fn === "sumif") {
    const range = Number(v.range);
    spec.range = Number.isInteger(range) && range >= 0 && range < columns ? range : undefined;
  }
  return spec;
}

export function serializeSummary(specs: SummarySpec[]): string {
  return JSON.stringify(specs.map((s) => (s ? { ...s } : null)));
}

// After inserting (`count` > 0) or deleting (< 0) columns at `at`: the specs
// that move with their columns, and SUMIF's condition columns renumbered (one
// whose column was deleted tests its own column).
export function shiftSummary(value: unknown, columns: number, at: number, count: number): string {
  const specs = parseSummary(value, columns);
  if (!specs) return typeof value === "string" ? value : "";
  const next = [...specs];
  if (count > 0) next.splice(at, 0, ...Array.from({ length: count }, () => null));
  else next.splice(at, -count);
  return serializeSummary(
    next.map((s) => {
      if (!s || s.range === undefined) return s;
      if (count > 0) return { ...s, range: s.range >= at ? s.range + count : s.range };
      if (s.range >= at && s.range < at - count) return { ...s, range: undefined };
      return { ...s, range: s.range >= at - count ? s.range + count : s.range };
    }),
  );
}

// A cell's text as a number: digits in any width, with thousands
// separators, a currency sign or a percent sign; null when it isn't one.
export function cellNumber(text: string): number | null {
  let s = text.normalize("NFKC").trim().replace(/[,\s]/g, "");
  if (s === "") return null;
  let scale = 1;
  if (s.endsWith("%")) {
    s = s.slice(0, -1);
    scale = 0.01;
  }
  s = s.replace(/^([+-]?)[¥$€£]/, "$1").replace(/(円|ドル)$/, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s) * scale;
  return Number.isFinite(n) ? n : null;
}

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "s");
}

// Whether a cell's text meets a condition (as a spreadsheet's COUNTIF).
export function matchesCriteria(cell: string, criteria: string): boolean {
  const m = /^(<>|>=|<=|=|>|<)?([\s\S]*)$/.exec(criteria.normalize("NFKC").trim())!;
  const op = m[1] ?? "=";
  const target = m[2].trim();
  const targetNumber = cellNumber(target);
  const cellNum = cellNumber(cell);
  if (op === "=" || op === "<>") {
    let equal: boolean;
    if (target === "") equal = cell.trim() === "";
    else if (targetNumber !== null && cellNum !== null) equal = cellNum === targetNumber;
    else equal = wildcard(norm(target)).test(norm(cell));
    return op === "=" ? equal : !equal;
  }
  // Order: numbers as numbers; otherwise text, in the usual order.
  let cmp: number;
  if (targetNumber !== null) {
    if (cellNum === null) return false;
    cmp = cellNum - targetNumber;
  } else {
    if (cell.trim() === "") return false;
    cmp = norm(cell).localeCompare(norm(target));
  }
  return op === ">" ? cmp > 0 : op === ">=" ? cmp >= 0 : op === "<" ? cmp < 0 : cmp <= 0;
}

// The value a column's summary shows, from the table's body (rows of cell
// texts, without the header row). null: nothing to show (no numbers to
// average, say).
export function summaryValue(spec: SummarySpec, rows: string[][], column: number): number | null {
  if (!spec) return null;
  const cells = rows.map((r) => r[column] ?? "");
  const numbers = cells.map(cellNumber).filter((n): n is number => n !== null);
  switch (spec.fn) {
    case "sum":
      return numbers.reduce((a, b) => a + b, 0);
    case "average":
      return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
    case "count":
      return numbers.length;
    case "counta":
      return cells.filter((c) => c.trim() !== "").length;
    case "min":
      return numbers.length ? Math.min(...numbers) : null;
    case "max":
      return numbers.length ? Math.max(...numbers) : null;
    case "countif":
      return cells.filter((c) => matchesCriteria(c, spec.criteria ?? "")).length;
    case "sumif": {
      const tested = spec.range ?? column;
      let sum = 0;
      rows.forEach((r) => {
        if (!matchesCriteria(r[tested] ?? "", spec.criteria ?? "")) return;
        sum += cellNumber(r[column] ?? "") ?? 0;
      });
      return sum;
    }
  }
}

// Rounded for showing (no floating-point tails like 0.30000000000000004).
export function roundSummary(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}
