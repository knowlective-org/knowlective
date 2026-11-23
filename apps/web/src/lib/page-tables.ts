import { CHECKED, type GridColumn, isValidText, parseColumns, selectedOptions } from "../components/editor/grid-types";
import { LINKED_UNSET, linkedSource } from "./linked-views";

// The tables in a page's body, read from its blocks for the public API and
// MCP (lib/api/page-tables.ts): BlockNote's tables and extended tables here;
// child page tables are only found here, their values live outside the
// document. Everything comes from the shared document, so it's read checked.
// A masked column's value is never returned (only that there is one).
// No dependencies (unit tests: test/page-tables.test.ts).

export type DocBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: DocBlock[];
};

export type TableKind = "table" | "extendedTable" | "childTable";
export type TableValue = string | number | boolean | string[] | { id: string; name: string | null } | { masked: true } | null;
export type TableColumnInfo = { name: string; type: string; options?: string[]; multiple?: boolean };
export type TableRow = { row: number; id?: string; title?: string; url?: string; values: Record<string, TableValue> };
export type ReadTable = { id: string; kind: TableKind; title: string | null; heading: string | null; columns: TableColumnInfo[]; rows: TableRow[] };
// A child page table (or a linked view of one): `source` is the page whose
// child pages it shows, null for a linked view with no page chosen yet.
export type ChildTableRef = { id: string; kind: "childTable"; title: string | null; heading: string | null; source: string | null };

function inlineText(content: unknown, people: Record<string, string>): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return "";
      const i = item as { type?: unknown; text?: unknown; content?: unknown; props?: { userId?: unknown } };
      if (i.type === "text") return typeof i.text === "string" ? i.text : "";
      if (i.type === "link") return inlineText(i.content, people);
      if (i.type === "mention") {
        const name = typeof i.props?.userId === "string" ? people[i.props.userId] : undefined;
        return name ? `@${name}` : "@";
      }
      return "";
    })
    .join("");
}

// The text of a cell's blocks. Tables inside it are tables of their own, and
// a masked block has only sealed text in its props: neither is read.
function blocksText(blocks: DocBlock[], people: Record<string, string>): string {
  const parts: string[] = [];
  const visit = (list: DocBlock[]) => {
    for (const b of list) {
      if (b.type === "table" || b.type === "gridTable" || b.type === "maskedText") continue;
      const text = inlineText(b.content, people);
      if (text) parts.push(text);
      else if (typeof b.props?.url === "string" && b.props.url) parts.push(String(b.props.name || b.props.caption || b.props.url));
      visit(b.children ?? []);
    }
  };
  visit(blocks);
  return parts.join(" ");
}

function firstMention(blocks: DocBlock[]): string | null {
  for (const b of blocks) {
    if (Array.isArray(b.content)) {
      for (const item of b.content as { type?: unknown; props?: { userId?: unknown } }[]) {
        if (item?.type === "mention" && typeof item.props?.userId === "string") return item.props.userId;
      }
    }
    const nested = firstMention(b.children ?? []);
    if (nested) return nested;
  }
  return null;
}

// Headers as column names: an empty one is "Column 3", and those sharing a
// name are "name (2)", … (as the child page tables' in the API).
export function columnNames(headers: string[]): string[] {
  const seen = new Set<string>();
  return headers.map((header, i) => {
    const base = header.replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
    let name = base;
    for (let n = 2; seen.has(name); n++) name = `${base} (${n})`;
    seen.add(name);
    return name;
  });
}

const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 1 ? Math.min(value, 1000) : 1);

// BlockNote's table: its rows of cells laid out by their spans (a merged
// cell's value is in its first column and row; the others are empty).
function readBlockTable(block: DocBlock, people: Record<string, string>): Pick<ReadTable, "columns" | "rows"> {
  const content = block.content as { headerRows?: unknown; rows?: unknown } | undefined;
  const source = Array.isArray(content?.rows) ? (content.rows as { cells?: unknown }[]) : [];
  const grid: string[][] = source.map(() => []);
  const taken = source.map(() => new Set<number>());
  source.forEach((row, r) => {
    let c = 0;
    for (const cell of Array.isArray(row?.cells) ? row.cells : []) {
      while (taken[r].has(c)) c++;
      const rich = !Array.isArray(cell) && cell && typeof cell === "object" ? (cell as { content?: unknown; props?: { colspan?: unknown; rowspan?: unknown } }) : null;
      const colspan = count(rich?.props?.colspan);
      const rowspan = count(rich?.props?.rowspan);
      grid[r][c] = inlineText(rich ? rich.content : cell, people);
      for (let y = r; y < Math.min(r + rowspan, source.length); y++) {
        for (let x = c; x < c + colspan; x++) taken[y].add(x);
      }
      c += colspan;
    }
  });
  const width = Math.max(0, ...taken.map((t) => (t.size ? Math.max(...t) + 1 : 0)));
  const headerRows = typeof content?.headerRows === "number" && content.headerRows > 0 ? Math.min(Math.floor(content.headerRows), source.length) : 0;
  const names = columnNames(Array.from({ length: width }, (_, i) => (headerRows > 0 ? (grid[0][i] ?? "") : "")));
  return {
    columns: names.map((name) => ({ name, type: "text" })),
    rows: grid.slice(headerRows).map((cells, i) => ({
      row: i + 1,
      values: Object.fromEntries(names.map((name, c) => [name, cells[c] || null])),
    })),
  };
}

function gridValue(cell: DocBlock[], rule: GridColumn | null, people: Record<string, string>): TableValue {
  if (rule?.type === "masked") return blocksText(cell, {}) ? { masked: true } : null;
  if (rule?.type === "user") {
    const id = firstMention(cell);
    return id ? { id, name: people[id] ?? null } : null;
  }
  const text = blocksText(cell, people);
  if (!rule) return text || null;
  if (rule.type === "checkbox" && isValidText(text, rule)) return text === CHECKED;
  if (text === "") return null;
  // Text that isn't a value of the column (from before it had the rule, or
  // written by an old screen) is returned as it is.
  if (!isValidText(text, rule)) return text;
  if (rule.type === "number") {
    const n = Number(text);
    // As a number only when that keeps every digit.
    return String(n) === text ? n : text;
  }
  if (rule.type === "select") {
    const { names } = selectedOptions(text, rule);
    return rule.multiple ? names : (names[0] ?? null);
  }
  return text;
}

function readGridTable(block: DocBlock, people: Record<string, string>): Pick<ReadTable, "columns" | "rows"> {
  const rows = block.children ?? [];
  const width = Math.max(0, ...rows.map((row) => row.children?.length ?? 0));
  const rules = parseColumns(block.props?.columns, width);
  const hasHeader = block.props?.headerRow !== false && rows.length > 0;
  const names = columnNames(
    Array.from({ length: width }, (_, i) => (hasHeader ? blocksText(rows[0].children?.[i]?.children ?? [], people) : "")),
  );
  return {
    columns: names.map((name, i) => {
      const rule = rules[i];
      return {
        name,
        type: rule?.type ?? "text",
        ...(rule?.type === "select" ? { options: rule.options.map((o) => o.name), multiple: rule.multiple } : {}),
      };
    }),
    rows: rows.slice(hasHeader ? 1 : 0).map((row, r) => ({
      row: r + 1,
      values: Object.fromEntries(names.map((name, c) => [name, gridValue(row.children?.[c]?.children ?? [], rules[c], people)])),
    })),
  };
}

// The tables of a page's blocks in document order (inside toggles, columns
// and extended tables' cells too), each with the heading above it.
// `people`: names for mentions, by user id.
export function findPageTables(blocks: DocBlock[], pageId: string, people: Record<string, string>): (ReadTable | ChildTableRef)[] {
  const found: (ReadTable | ChildTableRef)[] = [];
  let heading: string | null = null;
  const visit = (list: DocBlock[]) => {
    for (const b of list) {
      if (b.type === "heading") heading = inlineText(b.content, people) || heading;
      if (typeof b.id === "string" && b.id) {
        if (b.type === "table") {
          found.push({ id: b.id, kind: "table", title: null, heading, ...readBlockTable(b, people) });
        } else if (b.type === "gridTable") {
          found.push({ id: b.id, kind: "extendedTable", title: null, heading, ...readGridTable(b, people) });
        } else if (b.type === "childTable") {
          const title = typeof b.props?.title === "string" && b.props.title ? b.props.title : null;
          const source = b.props?.source === LINKED_UNSET ? null : (linkedSource(b.props?.source) ?? pageId);
          found.push({ id: b.id, kind: "childTable", title, heading, source });
        }
      }
      visit(b.children ?? []);
    }
  };
  visit(blocks);
  return found;
}

// Only the named columns (in the order asked for); unknown names are returned
// instead. No names: the whole table.
export function selectTableColumns<T extends Pick<ReadTable, "columns" | "rows">>(table: T, names?: string[]): T | { unknown: string[] } {
  if (!names || names.length === 0) return table;
  const known = new Map(table.columns.map((c) => [c.name, c]));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) return { unknown };
  const wanted = [...new Set(names)];
  return {
    ...table,
    columns: wanted.map((n) => known.get(n)!),
    rows: table.rows.map((row) => ({ ...row, values: Object.fromEntries(wanted.map((n) => [n, row.values[n] ?? null])) })),
  };
}
