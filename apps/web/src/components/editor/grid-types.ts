// The input rules of an extended table's columns (grid-table-block.ts): a
// column is plain text (its cells hold any blocks, as before) or of a type —
// a number, a date, an option (or several), a checkbox, a person, or a
// value masked with the column's passphrase. A typed column's cells (the
// header row's aside) hold its value only, put in with a control, kept as
// the cell's text, so search, the exports and the summary row read it as
// before:
//   number   "1234.5" (as typed, without separators)
//   date     "2026-12-01"
//   select   the options' names, one per line
//   checkbox "✓", or nothing
//   user     a mention of the person (the inline "mention")
//   masked   the sealed text (lib/secret-text.ts; never the plain text)
// Kept in the table's `columns` prop as JSON, one entry per column (null:
// text). From the shared document: read back checked (parseColumns).
// No dependencies (unit tests: test/grid-types.test.ts).

export const GRID_COLUMN_TYPES = ["number", "date", "select", "checkbox", "user", "masked"] as const;
export type GridColumnTypeName = (typeof GRID_COLUMN_TYPES)[number];

export type GridOption = { name: string; color: string };
// A number column's display (its values are kept as typed): thousands
// separators, and a fixed count of decimals (null: as typed).
export type GridColumn =
  | { type: "number"; grouping: boolean; decimals: number | null }
  | { type: "date" }
  | { type: "select"; multiple: boolean; options: GridOption[] }
  | { type: "checkbox" }
  | { type: "user" }
  | { type: "masked" };

export const MAX_GRID_OPTIONS = 50;
export const MAX_DECIMALS = 6;
export const MAX_OPTION_NAME = 100;
export const CHECKED = "✓";
// The options' colors, as the child page tables' (lib/page-property-types.ts).
export const GRID_OPTION_COLORS = ["#e3e2e0", "#fadec9", "#fdecc8", "#dbeddb", "#d3e5ef", "#e8deee", "#f5e0e9", "#ffe2dd"];

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function readColumn(raw: unknown): GridColumn | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case "number":
      return {
        type: "number",
        grouping: c.grouping !== false,
        decimals: typeof c.decimals === "number" && Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= MAX_DECIMALS ? c.decimals : null,
      };
    case "date":
    case "checkbox":
    case "user":
    case "masked":
      return { type: c.type };
    case "select": {
      const seen = new Set<string>();
      const options: GridOption[] = [];
      for (const o of Array.isArray(c.options) ? c.options.slice(0, MAX_GRID_OPTIONS) : []) {
        const name = o && typeof o === "object" ? (o as { name?: unknown }).name : undefined;
        if (typeof name !== "string") continue;
        const clean = cleanOptionName(name);
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        const color = (o as { color?: unknown }).color;
        options.push({ name: clean, color: isColor(color) ? color : GRID_OPTION_COLORS[options.length % GRID_OPTION_COLORS.length] });
      }
      return { type: "select", multiple: c.multiple === true, options };
    }
    default:
      return null;
  }
}

// An option's name: one line, trimmed, not too long.
export const cleanOptionName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_OPTION_NAME);

// The table's columns' rules, one per column (null: text).
export function parseColumns(value: unknown, columns: number): (GridColumn | null)[] {
  let list: unknown[] = [];
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      // Not JSON: all text.
    }
  }
  return Array.from({ length: columns }, (_, i) => readColumn(list[i]));
}

// As stored: "" when every column is text.
export function serializeColumns(columns: (GridColumn | null)[]): string {
  return columns.some(Boolean) ? JSON.stringify(columns) : "";
}

// After inserting (`count` > 0) or deleting (< 0) columns at `at`.
export function shiftColumns(value: unknown, columns: number, at: number, count: number): string {
  const list = parseColumns(value, columns);
  if (count > 0) list.splice(at, 0, ...Array.from({ length: count }, () => null));
  else list.splice(at, -count);
  return serializeColumns(list);
}

// A column moved from `from` to `to`.
export function moveColumnRule(value: unknown, columns: number, from: number, to: number): string {
  const list = parseColumns(value, columns);
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return serializeColumns(list);
}

// --- Values ------------------------------------------------------------------

// A stored number as the column shows it ("" stays ""; a value that isn't
// one is shown as it is).
export function formatNumber(value: string, column: Extract<GridColumn, { type: "number" }>, locale?: string): string {
  if (value === "" || normalizeNumber(value) !== value) return value;
  const typed = value.split(".")[1]?.length ?? 0;
  const digits = column.decimals ?? typed;
  return new Intl.NumberFormat(locale, { useGrouping: column.grouping, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value));
}

// A number as typed in any width, with thousands separators or spaces; its
// stored form ("1234.5"), or null when it isn't one. "" stays "" (empty).
export function normalizeNumber(text: string): string | null {
  const s = text.normalize("NFKC").trim().replace(/[,\s]/g, "").replace(/^\+/, "");
  if (s === "") return "";
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // As typed (its decimals kept), without a leading "." or trailing ".".
  return s.replace(/^(-?)\./, "$10.").replace(/\.$/, "").replace(/^(-?)0+(?=\d)/, "$1");
}

// A date as "2026-12-01", "2026/12/1" or "2026年12月1日"; "YYYY-MM-DD", or
// null when it isn't a real date. "" stays "".
export function normalizeDate(text: string): string | null {
  const s = text.normalize("NFKC").trim();
  if (s === "") return "";
  const m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const TRUE_WORDS = new Set([CHECKED, "☑", "✔", "x", "true", "yes", "on", "1", "はい", "済", "完了", "o", "○", "◯"]);
const FALSE_WORDS = new Set(["", "☐", "false", "no", "off", "0", "いいえ", "未", "-"]);

// A checkbox's value from text: CHECKED or "", or null when it can't tell.
export function normalizeCheckbox(text: string): string | null {
  const s = text.normalize("NFKC").trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return CHECKED;
  if (FALSE_WORDS.has(s)) return "";
  return null;
}

// The options a cell's text names (one per line; text that was typed by
// hand may separate them with commas too), in the column's order.
export function selectedOptions(text: string, column: Extract<GridColumn, { type: "select" }>): { names: string[]; unknown: string[] } {
  const parts = text
    .split(/\n|,|、/)
    .map(cleanOptionName)
    .filter(Boolean);
  const known = new Set(column.options.map((o) => o.name));
  const names = column.options.map((o) => o.name).filter((n) => parts.includes(n));
  return { names: column.multiple ? names : names.slice(0, 1), unknown: [...new Set(parts.filter((p) => !known.has(p)))] };
}

// Whether a cell's text is a value of the column (empty is one). Users and
// masked values aren't text: checked where they're shown.
export function isValidText(text: string, column: GridColumn): boolean {
  switch (column.type) {
    case "number":
      return normalizeNumber(text) === text;
    case "date":
      return normalizeDate(text) === text;
    case "checkbox":
      return text === "" || text === CHECKED;
    case "select": {
      if (text === "") return true;
      const { names, unknown } = selectedOptions(text, column);
      return unknown.length === 0 && names.join("\n") === text;
    }
    default:
      return true;
  }
}

// The cells' texts of a column turned into the new type: each one's value,
// or null where it can't be (left empty, after asking). For options, those
// named by the texts are added to the column (as many as fit). Users and
// masked values are made by the editor (they need the page's people, or a
// passphrase).
export function convertTexts(
  texts: string[],
  column: GridColumn,
): { values: (string | null)[]; column: GridColumn } {
  switch (column.type) {
    case "number":
      return { values: texts.map(normalizeNumber), column };
    case "date":
      return { values: texts.map(normalizeDate), column };
    case "checkbox":
      return { values: texts.map(normalizeCheckbox), column };
    case "select": {
      const options = [...column.options];
      for (const text of texts) {
        for (const part of text.split(/\n|,|、/).map(cleanOptionName).filter(Boolean)) {
          if (options.length >= MAX_GRID_OPTIONS) break;
          if (!options.some((o) => o.name === part)) options.push({ name: part, color: GRID_OPTION_COLORS[options.length % GRID_OPTION_COLORS.length] });
        }
      }
      const next = { ...column, options };
      return {
        values: texts.map((text) => {
          if (text.trim() === "") return "";
          const { names, unknown } = selectedOptions(text, next);
          if (unknown.length > 0 || (!next.multiple && text.split(/\n|,|、/).filter((p) => cleanOptionName(p)).length > 1)) return null;
          return names.join("\n");
        }),
        column: next,
      };
    }
    default:
      return { values: texts.map((t) => (t.trim() === "" ? "" : null)), column };
  }
}
