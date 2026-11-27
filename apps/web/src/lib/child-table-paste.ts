// Text pasted into a child page table (child-table-block.tsx): which cells
// get which values. Each pasted text becomes a value of its cell's column
// where it is one — an option or a person named by it, a date written as
// "2026-12-01", "2026/12/1" or "2026年12月1日", text within the column's
// length — and is left out otherwise (as are cells of the title and the
// built-in columns, masked values, which are sealed in the browser one by
// one, and rows the viewer can't edit). Rows aren't added: what's beyond the
// table's rows or columns is left out.
//
// Dependency-free (the date rule is the extended table's): unit-tested
// (test/child-table-paste.test.ts).

import { normalizeDate } from "../components/editor/grid-types";
import type { PropertyColumn, UserRef } from "./page-property-types";

const MAX_TEXT = 2000;
const MAX_LONG_TEXT = 10000;

const looseKey = (s: string) => s.normalize("NFKC").trim().toLowerCase();

// The one of `items` a text names: by its name (spaces at the ends aside);
// else ignoring case and full/half width, when only one fits.
function named<T extends { name: string }>(items: T[], text: string): T | null {
  const name = text.trim();
  if (!name) return null;
  const exact = items.filter((o) => o.name.trim() === name);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null;
  const loose = items.filter((o) => looseKey(o.name) === looseKey(name));
  return loose.length === 1 ? loose[0] : null;
}

// The option a pasted text names.
export const optionForText = <T extends { name: string }>(options: T[], text: string): T | null => named(options, text);

// The value a pasted text is in a column ("" clears the cell), or null when
// it's none of the column's.
export function pastedPropertyValue(column: PropertyColumn, raw: string, people: UserRef[]): string | null {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  switch (column.type) {
    case "TEXT": {
      // One line: a spreadsheet cell's lines joined.
      const line = text.replace(/\s*\n\s*/g, " ");
      return line.length <= MAX_TEXT ? line : null;
    }
    case "LONG_TEXT":
      return text.length <= MAX_LONG_TEXT ? text : null;
    case "DATE":
      return normalizeDate(text);
    case "SELECT":
      return text === "" ? "" : (named(column.options, text)?.id ?? null);
    case "USER":
      return text === "" ? "" : (named(people, text)?.id ?? null);
    case "MASKED":
      return null;
  }
}

export type PasteRow = { id: string; canEdit: boolean; values: Record<string, string> };
export type PasteChange = { pageId: string; columnId: string; value: string };
export type PastePlan = {
  changes: PasteChange[];
  // Pasted cells left out: not a value of their column, not editable, the
  // title or a built-in column, a masked column.
  skipped: number;
  // Some of the pasted table was beyond the table's rows or columns.
  cut: boolean;
};

// `columns`: the table's columns as shown, from the title (index 0); null
// for the title and the built-in columns. `at`: the cell the paste starts
// from; `fill`: the cells selected, filled with a single pasted value (a
// table of more is pasted from their top left).
export function planTablePaste({
  pasted,
  at,
  fill,
  rows,
  columns,
  people,
}: {
  pasted: string[][];
  at: { r: number; c: number };
  fill?: { rows: number; columns: number };
  rows: PasteRow[];
  columns: (PropertyColumn | null)[];
  people: UserRef[];
}): PastePlan {
  const single = pasted.length === 1 && pasted[0].length === 1;
  const height = single && fill ? fill.rows : pasted.length;
  const width = single && fill ? fill.columns : Math.max(0, ...pasted.map((r) => r.length));
  const changes: PasteChange[] = [];
  let skipped = 0;
  let cut = false;
  for (let dr = 0; dr < height; dr++) {
    for (let dc = 0; dc < width; dc++) {
      const text = single ? pasted[0][0] : pasted[dr]?.[dc];
      if (text === undefined) continue;
      const row = rows[at.r + dr];
      const c = at.c + dc;
      if (!row || c >= columns.length) {
        cut = true;
        continue;
      }
      const column = columns[c];
      const value = column && row.canEdit ? pastedPropertyValue(column, text, people) : null;
      if (!column || value === null) {
        skipped++;
        continue;
      }
      if ((row.values[column.id] ?? "") !== value) changes.push({ pageId: row.id, columnId: column.id, value });
    }
  }
  return { changes, skipped, cut };
}
