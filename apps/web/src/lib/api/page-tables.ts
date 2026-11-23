import { prisma } from "@/lib/db";
import { childProperties } from "@/lib/api/child-properties";
import { currentPageState } from "@/lib/api/page-content";
import { bodyToBlocks } from "@/lib/markdown-bridge";
import { pagePeople } from "@/lib/page-people";
import {
  type ChildTableRef,
  type DocBlock,
  type ReadTable,
  type TableValue,
  findPageTables,
  selectTableColumns,
} from "@/lib/page-tables";

// The tables in a page's body for the public API and MCP: BlockNote's tables,
// extended tables and child page tables (linked views too), listed, or read
// whole or by column. The caller has checked that `userId` can open the page;
// a child page table's rows are read with their own access to its source.

export const DEFAULT_TABLE_ROWS = 1000;
export const MAX_TABLE_ROWS = 5000;

export type TableSummary = {
  id: string;
  kind: ReadTable["kind"];
  title: string | null;
  heading: string | null;
  available: boolean;
  columns: ReadTable["columns"];
  rowCount: number;
};

export type TableResult =
  | (Omit<ReadTable, "rows"> & { rows: ReadTable["rows"]; totalRows: number; offset: number; nextOffset: number | null })
  | { unknown: string[] }
  | { unavailable: true }
  | null;

async function loadTables(pageId: string): Promise<(ReadTable | ChildTableRef)[]> {
  const state = await currentPageState(pageId);
  if (!state) return [];
  const people = Object.fromEntries((await pagePeople(prisma, pageId)).map((p) => [p.id, p.name]));
  return findPageTables((await bodyToBlocks(state)) as DocBlock[], pageId, people);
}

// A child page table with its rows, as `userId` sees them; null when they
// can't open its page (or a linked view has none chosen). A person's name
// only if they have one on that page: never their email address.
async function readChildTable(userId: string, ref: ChildTableRef): Promise<ReadTable | null> {
  if (!ref.source) return null;
  const data = await childProperties(userId, ref.source);
  if (!data || "unknown" in data) return null;
  const names = new Map((await pagePeople(prisma, ref.source)).map((p) => [p.id, p.name]));
  const value = (v: unknown): TableValue => {
    if (v && typeof v === "object" && "id" in v) {
      const id = String((v as { id: unknown }).id);
      return { id, name: names.get(id) ?? null };
    }
    return v as TableValue;
  };
  return {
    id: ref.id,
    kind: "childTable",
    title: ref.title,
    heading: ref.heading,
    columns: data.columns.map((c) => ({ name: c.name, type: c.type.toLowerCase(), ...(c.options ? { options: c.options } : {}) })),
    rows: data.children.map((child, i) => ({
      row: i + 1,
      id: child.id,
      title: child.title,
      url: child.url,
      values: Object.fromEntries(Object.entries(child.properties).map(([k, v]) => [k, value(v)])),
    })),
  };
}

const isRead = (t: ReadTable | ChildTableRef): t is ReadTable => "rows" in t;

export async function listPageTables(userId: string, pageId: string): Promise<TableSummary[]> {
  const tables = await loadTables(pageId);
  return Promise.all(
    tables.map(async (t) => {
      const read = isRead(t) ? t : await readChildTable(userId, t);
      return {
        id: t.id,
        kind: t.kind,
        title: t.title,
        heading: t.heading,
        available: read !== null,
        columns: read?.columns ?? [],
        rowCount: read?.rows.length ?? 0,
      };
    }),
  );
}

// One table: every column, or only those named. Null: no such table on the page.
export async function readPageTable(
  userId: string,
  pageId: string,
  tableId: string,
  options: { columns?: string[]; offset?: number; limit?: number } = {},
): Promise<TableResult> {
  const found = (await loadTables(pageId)).find((t) => t.id === tableId);
  if (!found) return null;
  const table = isRead(found) ? found : await readChildTable(userId, found);
  if (!table) return { unavailable: true };
  const selected = selectTableColumns(table, options.columns);
  if ("unknown" in selected) return selected;
  const offset = options.offset ?? 0;
  const limit = Math.min(options.limit ?? DEFAULT_TABLE_ROWS, MAX_TABLE_ROWS);
  const end = offset + limit;
  return {
    ...selected,
    rows: selected.rows.slice(offset, end),
    totalRows: selected.rows.length,
    offset,
    nextOffset: end < selected.rows.length ? end : null,
  };
}
