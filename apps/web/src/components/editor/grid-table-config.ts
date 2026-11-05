// The extended table ("gridTable"): a table whose cells hold blocks
// (paragraphs, lists, images, code…), not only text as BlockNote's table does.
// Three node types, like BlockNote's columns (columnList / column):
//
//   gridTable (props: header row, header column, column widths)
//     gridRow
//       gridCell → the blocks in the cell
//
// The node configs here (for Tiptap's Node.create) are shared by the editor
// (grid-table-block.ts, which adds the controls) and the server's schema
// (server/markdown-engine.mts). Keep dependency-free.
//
// Saved in page documents: never remove or rename these types, props or
// attributes once released.

export const GRID_TABLE_TYPES = ["gridTable", "gridRow", "gridCell"] as const;

export const GRID_TABLE_PROPS = {
  // The first row as column headings.
  headerRow: { default: true },
  // The first column as row titles.
  headerColumn: { default: false },
  // JSON array of the columns' relative widths; "" (or a column missing
  // from it) is 1.
  widths: { default: "" },
} as const;

export const MAX_GRID_COLUMNS = 20;
export const MAX_GRID_ROWS = 200;

type Attributes = Record<string, unknown>;

// Like BlockNote's blocks, each node has an id (UniqueID only gives ids to its
// own types; the editor gives these theirs, grid-table-block.ts).
const id = {
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute("data-id"),
  renderHTML: (attrs: Attributes) => (attrs.id ? { "data-id": attrs.id } : {}),
};

const flag = (prop: string, attribute: string, fallback: boolean) => ({
  default: fallback,
  parseHTML: (el: HTMLElement) => {
    const value = el.getAttribute(attribute);
    return value === null ? fallback : value === "true";
  },
  renderHTML: (attrs: Attributes) => ({ [attribute]: String(attrs[prop]) }),
});

const byNodeType = (type: string) => [{ tag: `div[data-node-type="${type}"]` }];

export const GRID_TABLE_NODES = {
  gridTable: {
    name: "gridTable",
    group: "childContainer bnBlock blockGroupChild",
    content: "gridRow+",
    // Below blockContainer, as BlockNote's columns.
    priority: 40,
    defining: true,
    isolating: true,
    addAttributes: () => ({
      id,
      headerRow: flag("headerRow", "data-header-row", true),
      headerColumn: flag("headerColumn", "data-header-column", false),
      widths: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-widths") ?? "",
        renderHTML: (attrs: Attributes) => (attrs.widths ? { "data-widths": attrs.widths } : {}),
      },
    }),
    parseHTML: () => byNodeType("gridTable"),
    renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Attributes }) =>
      ["div", { ...HTMLAttributes, "data-node-type": "gridTable", class: "kn-grid-table", role: "table" }, 0] as const,
  },
  gridRow: {
    name: "gridRow",
    group: "childContainer bnBlock",
    content: "gridCell+",
    priority: 40,
    defining: true,
    isolating: true,
    addAttributes: () => ({ id }),
    parseHTML: () => byNodeType("gridRow"),
    renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Attributes }) =>
      ["div", { ...HTMLAttributes, "data-node-type": "gridRow", class: "kn-grid-row", role: "row" }, 0] as const,
  },
  gridCell: {
    name: "gridCell",
    group: "childContainer bnBlock",
    // Any block, columns and tables included.
    content: "blockGroupChild+",
    priority: 40,
    defining: true,
    // Editing (backspacing, joining, lifting) doesn't cross a cell's sides.
    isolating: true,
    addAttributes: () => ({ id }),
    parseHTML: () => byNodeType("gridCell"),
    renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Attributes }) =>
      ["div", { ...HTMLAttributes, "data-node-type": "gridCell", class: "kn-grid-cell", role: "cell" }, 0] as const,
  },
};

// The columns' relative widths, one per column.
export function gridWidths(widths: unknown, columns: number): number[] {
  let parsed: unknown = [];
  try {
    parsed = typeof widths === "string" && widths ? JSON.parse(widths) : [];
  } catch {
    parsed = [];
  }
  const list = Array.isArray(parsed) ? parsed : [];
  return Array.from({ length: columns }, (_, i) => {
    const w = Number(list[i]);
    return Number.isFinite(w) && w > 0 ? Math.min(w, 1000) : 1;
  });
}
