// A BlockNote table turned into an extended table (gridTable), from the ⋮⋮
// menu: each cell's text and its colors and alignment become a paragraph in
// the cell, the header row and column carry over, and the column widths
// become relative ones. Merged cells are split: the text stays in the first
// cell, the others are left empty. Dependency-free (unit tested).

import { MAX_GRID_COLUMNS, MAX_GRID_ROWS } from "./grid-table-config";

// BlockNote's tableContent, as getBlock() gives it (a cell may also be its
// inline content alone, as in a partial block).
type CellProps = { colspan?: number; rowspan?: number; textColor?: string; backgroundColor?: string; textAlignment?: string };
type Cell = { type?: string; props?: CellProps; content?: unknown } | unknown[] | string;
export type TableContentLike = {
  columnWidths?: (number | null | undefined)[];
  headerRows?: number;
  headerCols?: number;
  rows: { cells: Cell[] }[];
};

// BlockNote's column width when none was set (its table's default).
const DEFAULT_WIDTH = 120;

type Placed = { content: unknown[]; props: CellProps } | null;

function cellParts(cell: Cell): { content: unknown[]; props: CellProps } {
  if (typeof cell === "string") return { content: cell ? [{ type: "text", text: cell, styles: {} }] : [], props: {} };
  if (Array.isArray(cell)) return { content: cell, props: {} };
  const content = cell.content;
  const inline = typeof content === "string" ? (content ? [{ type: "text", text: content, styles: {} }] : []) : Array.isArray(content) ? content : [];
  return { content: inline, props: cell.props ?? {} };
}

const span = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 1 ? n : 1);

// The cells on a grid, merged ones taking the places they cover (left empty).
function placeCells(rows: { cells: Cell[] }[]): Placed[][] {
  const grid: Placed[][] = rows.map(() => []);
  const taken: boolean[][] = rows.map(() => []);
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      while (taken[r][c]) c++;
      const parts = cellParts(cell);
      const cols = span(parts.props.colspan);
      const down = Math.min(span(parts.props.rowspan), rows.length - r);
      for (let dr = 0; dr < down; dr++) {
        for (let dc = 0; dc < cols; dc++) {
          taken[r + dr][c + dc] = true;
          grid[r + dr][c + dc] = dr === 0 && dc === 0 ? parts : null;
        }
      }
      c += cols;
    }
  });
  return grid;
}

export type GridFromTable =
  | { ok: true; block: { id?: string; type: "gridTable"; props: Record<string, unknown>; children: unknown[] } }
  | { ok: false; reason: "rows" | "columns"; max: number };

export function tableToGrid(table: TableContentLike, id?: string): GridFromTable {
  const grid = placeCells(table.rows ?? []);
  const columns = Math.max(1, ...grid.map((row) => row.length));
  const rows = Math.max(1, grid.length);
  if (rows > MAX_GRID_ROWS) return { ok: false, reason: "rows", max: MAX_GRID_ROWS };
  if (columns > MAX_GRID_COLUMNS) return { ok: false, reason: "columns", max: MAX_GRID_COLUMNS };

  const children = Array.from({ length: rows }, (_, r) => ({
    type: "gridRow",
    children: Array.from({ length: columns }, (_, c) => {
      const placed = grid[r]?.[c] ?? null;
      const { textColor, backgroundColor, textAlignment } = placed?.props ?? {};
      const props: Record<string, string> = {};
      if (typeof textColor === "string" && textColor !== "default") props.textColor = textColor;
      if (typeof backgroundColor === "string" && backgroundColor !== "default") props.backgroundColor = backgroundColor;
      if (typeof textAlignment === "string" && textAlignment !== "left") props.textAlignment = textAlignment;
      return { type: "gridCell", children: [{ type: "paragraph", props, content: placed?.content ?? [] }] };
    }),
  }));

  const set = (table.columnWidths ?? []).slice(0, columns);
  const widths = Array.from({ length: columns }, (_, i) => {
    const w = set[i];
    return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : DEFAULT_WIDTH;
  });
  const sameWidths = widths.every((w) => w === widths[0]);
  return {
    ok: true,
    block: {
      ...(id ? { id } : {}),
      type: "gridTable",
      props: {
        headerRow: (table.headerRows ?? 0) > 0,
        headerColumn: (table.headerCols ?? 0) > 0,
        widths: sameWidths ? "" : JSON.stringify(widths.map((w) => Math.round((w / DEFAULT_WIDTH) * 100) / 100)),
      },
      children,
    },
  };
}
