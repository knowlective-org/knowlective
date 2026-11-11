import { UniqueID, createBlockSpecFromTiptapNode, createExtension, type BlockNoteEditor } from "@blocknote/core";
import { Node } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { showConfirm } from "../dialog";
import {
  GRID_TABLE_NODES,
  GRID_TABLE_PROPS,
  GRID_TABLE_TYPES,
  MAX_GRID_COLUMNS,
  MAX_GRID_ROWS,
  gridWidths,
} from "./grid-table-config";
import {
  MAX_CRITERIA_LENGTH,
  SUMMARY_FUNCTIONS,
  type SummaryFunction,
  type SummarySpec,
  parseSummary,
  roundSummary,
  serializeSummary,
  shiftSummary,
  summaryValue,
} from "./grid-summary";

// The extended table in the editor (the nodes: grid-table-config.ts):
// - for editors, a bar above it (header row, header column, adding a row or
//   a column, deleting the table) and a menu in each cell (inserting and
//   deleting the cell's row and column), and the columns' widths by dragging
//   a cell's right edge;
// - its structure kept whole: every row has as many cells as the widest one
//   and every node its own id (after any local change), and Backspace,
//   Delete and Shift+Tab at a cell's edge don't move blocks out of it.
// Rows and cells are divs with ARIA roles, not <table> (BlockNote's table
// extension takes any <td> under the mouse for its own table).

type GridText = {
  toolbar: string;
  headerRow: string;
  headerColumn: string;
  addRow: string;
  addColumn: string;
  deleteTable: string;
  deleteTableConfirm: string;
  cellMenu: string;
  insertRowAbove: string;
  insertRowBelow: string;
  insertColumnLeft: string;
  insertColumnRight: string;
  deleteRow: string;
  deleteColumn: string;
  resize: string;
  summaryRow: string;
  summaryLabel: string;
  summaryMenu: string;
  summaryNone: string;
  summaryFunctions: Record<SummaryFunction, string>;
  summaryCriteria: string;
  summaryCriteriaHint: string;
  summaryRange: string;
  summaryThisColumn: string;
  summaryColumn: string;
  summaryApply: string;
};

type Editor = Pick<BlockNoteEditor, "dictionary" | "isEditable">;

// Our text, put in BlockNote's dictionary by blockNoteDictionary().
const gridText = (editor: Editor) => (editor.dictionary as unknown as { knowlective_grid: GridText }).knowlective_grid;

const newId = (): string => UniqueID.options.generateID();

// A column can't be dragged narrower than this.
const MIN_COLUMN_PX = 60;

function emptyCell(schema: Schema): PMNode {
  return schema.nodes.gridCell.create(
    { id: newId() },
    schema.nodes.blockContainer.create({ id: newId() }, schema.nodes.paragraph.create()),
  );
}

function columnCount(table: PMNode): number {
  let n = 0;
  table.forEach((row) => {
    n = Math.max(n, row.childCount);
  });
  return n;
}

// The positions before each child of `node`, which starts at `pos`.
function childPositions(node: PMNode, pos: number): number[] {
  const out: number[] = [];
  let at = pos + 1;
  node.forEach((child) => {
    out.push(at);
    at += child.nodeSize;
  });
  return out;
}

function columnsTemplate(widths: number[]): string {
  return widths.map((w) => `minmax(var(--kn-grid-min-width), ${w}fr)`).join(" ");
}

// Where a cell is: its table's position, its row and its column.
function cellPlace(state: EditorState, cellPos: number): { tablePos: number; row: number; col: number } | null {
  const $cell = state.doc.resolve(cellPos);
  const rowDepth = $cell.depth;
  if ($cell.parent.type.name !== "gridRow" || $cell.node(rowDepth - 1).type.name !== "gridTable") return null;
  return { tablePos: $cell.before(rowDepth - 1), row: $cell.index(rowDepth - 1), col: $cell.index(rowDepth) };
}

function tableAt(state: EditorState, tablePos: number): PMNode | null {
  const table = state.doc.nodeAt(tablePos);
  return table?.type.name === "gridTable" ? table : null;
}

function insertRow(view: EditorView, tablePos: number, at: number) {
  const { state } = view;
  const table = tableAt(state, tablePos);
  if (!table || table.childCount >= MAX_GRID_ROWS) return;
  const cells = Array.from({ length: columnCount(table) }, () => emptyCell(state.schema));
  const row = state.schema.nodes.gridRow.create({ id: newId() }, cells);
  const rows = childPositions(table, tablePos);
  const pos = at < rows.length ? rows[at] : tablePos + table.nodeSize - 1;
  const tr = state.tr.insert(pos, row);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function insertColumn(view: EditorView, tablePos: number, at: number) {
  const { state } = view;
  const table = tableAt(state, tablePos);
  const columns = table ? columnCount(table) : 0;
  if (!table || columns >= MAX_GRID_COLUMNS) return;
  at = Math.min(at, columns);
  const tr = state.tr;
  const rows = childPositions(table, tablePos);
  // From the last row up: inserting moves only what comes after.
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = table.child(r);
    const cells = childPositions(row, rows[r]);
    tr.insert(at < cells.length ? cells[at] : rows[r] + row.nodeSize - 1, emptyCell(state.schema));
  }
  const widths = gridWidths(table.attrs.widths, columns);
  // As wide as the others are on average.
  widths.splice(at, 0, widths.reduce((a, b) => a + b, 0) / widths.length);
  tr.setNodeAttribute(tablePos, "widths", JSON.stringify(widths.map((w) => Math.round(w * 100) / 100)));
  if (table.attrs.summary) tr.setNodeAttribute(tablePos, "summary", shiftSummary(table.attrs.summary, columns, at, 1));
  const firstCell = childPositions(tr.doc.nodeAt(tablePos)!.child(0), rows[0])[at];
  tr.setSelection(TextSelection.near(tr.doc.resolve(firstCell + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function deleteRow(view: EditorView, tablePos: number, at: number) {
  const { state } = view;
  const table = tableAt(state, tablePos);
  if (!table || table.childCount <= 1) return;
  const pos = childPositions(table, tablePos)[at];
  view.dispatch(state.tr.delete(pos, pos + table.child(at).nodeSize));
}

function deleteColumn(view: EditorView, tablePos: number, at: number) {
  const { state } = view;
  const table = tableAt(state, tablePos);
  const columns = table ? columnCount(table) : 0;
  if (!table || columns <= 1) return;
  const tr = state.tr;
  const rows = childPositions(table, tablePos);
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = table.child(r);
    if (at >= row.childCount || row.childCount <= 1) continue;
    const pos = childPositions(row, rows[r])[at];
    tr.delete(pos, pos + row.child(at).nodeSize);
  }
  const widths = gridWidths(table.attrs.widths, columns);
  widths.splice(at, 1);
  tr.setNodeAttribute(tablePos, "widths", JSON.stringify(widths));
  if (table.attrs.summary) tr.setNodeAttribute(tablePos, "summary", shiftSummary(table.attrs.summary, columns, at, -1));
  view.dispatch(tr);
}

// In its place, an empty paragraph (the page keeps a block there).
function deleteTable(view: EditorView, tablePos: number) {
  const { state } = view;
  const table = tableAt(state, tablePos);
  if (!table) return;
  const paragraph = state.schema.nodes.blockContainer.create({ id: newId() }, state.schema.nodes.paragraph.create());
  const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1)));
  view.dispatch(tr);
  view.focus();
}

function setTableAttr(view: EditorView, tablePos: number, name: string, value: unknown) {
  if (!tableAt(view.state, tablePos)) return;
  view.dispatch(view.state.tr.setNodeAttribute(tablePos, name, value));
}

// --- Keeping the structure whole -------------------------------------------

const gridKey = new PluginKey("knowlective-grid-table");
const GRID_TYPE_NAMES = new Set<string>(GRID_TABLE_TYPES);

// After local changes (remote ones were fixed where they were made): ids for
// table, row and cell nodes without one or with a copied one (pasting), and
// empty cells for rows shorter than the table's widest.
function gridStructurePlugin(): Plugin {
  return new Plugin({
    key: gridKey,
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((t) => t.docChanged)) return null;
      if (transactions.some((t) => t.getMeta("y-sync$") || t.getMeta(gridKey))) return null;
      const tr = state.tr;
      const seen = new Set<string>();
      let found = false;
      state.doc.descendants((node, pos) => {
        if (!GRID_TYPE_NAMES.has(node.type.name)) return true;
        found = true;
        const id = node.attrs.id as string | null;
        if (!id || seen.has(id)) tr.setNodeAttribute(tr.mapping.map(pos), "id", newId());
        else seen.add(id);
        if (node.type.name === "gridTable") {
          const columns = columnCount(node);
          const rows = childPositions(node, pos);
          node.forEach((row, _offset, r) => {
            const missing = columns - row.childCount;
            if (missing <= 0) return;
            const end = tr.mapping.map(rows[r] + row.nodeSize - 1);
            tr.insert(end, Array.from({ length: missing }, () => emptyCell(state.schema)));
          });
        }
        return true;
      });
      if (!found || !tr.docChanged) return null;
      return tr.setMeta(gridKey, true);
    },
  });
}

// Backspace at the start of a cell's first block, or Delete at the end of its
// last: BlockNote would merge the block with the neighbouring cell's.
function atCellEdge(state: EditorState, edge: "start" | "end"): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  const depth = $from.depth;
  if (depth < 3 || $from.parent.type.spec.code) return false;
  if (edge === "start") {
    if ($from.parentOffset !== 0 || $from.parent.type.name !== "paragraph") return false;
    return $from.node(depth - 2).type.name === "gridCell" && $from.index(depth - 2) === 0;
  }
  if ($from.parentOffset !== $from.parent.content.size) return false;
  // Up through the blocks this text ends, to its cell.
  for (let d = depth - 1; d >= 0; d--) {
    const node = $from.node(d);
    if ($from.index(d) !== node.childCount - 1) return false;
    if (node.type.name === "gridCell") return true;
  }
  return false;
}

// Shift+Tab on a block right in a cell: there's nothing to unnest it from,
// and BlockNote would lift it out of the cell.
function directlyInCell(state: EditorState): boolean {
  const { $from } = state.selection;
  const depth = $from.depth;
  if (depth < 3 || $from.parent.type.spec.code) return false;
  return $from.node(depth - 2).type.name === "gridCell";
}

const gridExtension = createExtension({
  key: "knowlective-grid-table",
  keyboardShortcuts: {
    Backspace: ({ editor }) => atCellEdge(editor.prosemirrorState, "start"),
    Delete: ({ editor }) => atCellEdge(editor.prosemirrorState, "end"),
    "Shift-Tab": ({ editor }) => directlyInCell(editor.prosemirrorState),
  },
  prosemirrorPlugins: [gridStructurePlugin()],
});

// --- Controls ---------------------------------------------------------------

function button(label: string, ui: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.ui = ui;
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return b;
}

function checkbox(label: string, ui: string, onChange: (checked: boolean) => void): { dom: HTMLLabelElement; input: HTMLInputElement } {
  const dom = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.ui = ui;
  input.addEventListener("change", () => onChange(input.checked));
  dom.append(input, document.createTextNode(label));
  return { dom, input };
}

let openMenu: { close: () => void } | null = null;

// A cell's menu, under its button (in the page's body: the table may scroll).
function showCellMenu(anchor: HTMLElement, items: { label: string; ui: string; run: () => void; disabled?: boolean }[]) {
  openMenu?.close();
  const menu = document.createElement("div");
  menu.className = "kn-grid-menu";
  menu.dataset.ui = "GridTable.cellMenu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const b = button(item.label, item.ui, () => {
      close();
      item.run();
    });
    b.setAttribute("role", "menuitem");
    b.disabled = !!item.disabled;
    menu.append(b);
  }
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
  document.body.append(menu);
  const onPointer = (event: PointerEvent) => {
    if (!menu.contains(event.target as globalThis.Node) && event.target !== anchor) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      anchor.focus();
    }
  };
  function close() {
    menu.remove();
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", close, true);
    if (openMenu?.close === close) openMenu = null;
  }
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", close, true);
  openMenu = { close };
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

// A column's summary menu (in the page's body, as the cell menu): what it
// shows, and the condition for COUNTIF / SUMIF.
function showSummaryMenu(
  anchor: HTMLElement,
  text: GridText,
  columns: number,
  col: number,
  current: SummarySpec,
  apply: (spec: SummarySpec) => void,
) {
  openMenu?.close();
  const menu = document.createElement("form");
  menu.className = "kn-grid-menu kn-grid-summary-menu";
  menu.dataset.ui = "GridTable.summaryMenu";
  menu.setAttribute("aria-label", text.summaryMenu);

  const fn = document.createElement("select");
  fn.dataset.ui = "GridTable.summaryFunctionSelect";
  fn.setAttribute("aria-label", text.summaryMenu);
  fn.append(new Option(text.summaryNone, ""));
  for (const f of SUMMARY_FUNCTIONS) fn.append(new Option(text.summaryFunctions[f], f));
  fn.value = current?.fn ?? "";

  const criteriaLabel = document.createElement("label");
  const criteria = document.createElement("input");
  criteria.dataset.ui = "GridTable.summaryCriteriaInput";
  criteria.maxLength = MAX_CRITERIA_LENGTH;
  criteria.value = current?.criteria ?? "";
  criteria.placeholder = text.summaryCriteriaHint;
  criteria.title = text.summaryCriteriaHint;
  criteriaLabel.append(document.createTextNode(text.summaryCriteria), criteria);

  const rangeLabel = document.createElement("label");
  const range = document.createElement("select");
  range.dataset.ui = "GridTable.summaryRangeSelect";
  for (let i = 0; i < columns; i++) {
    range.append(new Option(i === col ? text.summaryThisColumn : text.summaryColumn.replace("{n}", String(i + 1)), String(i)));
  }
  range.value = String(current?.range ?? col);
  rangeLabel.append(document.createTextNode(text.summaryRange), range);

  const sync = () => {
    criteriaLabel.hidden = fn.value !== "countif" && fn.value !== "sumif";
    rangeLabel.hidden = fn.value !== "sumif";
  };
  fn.addEventListener("change", sync);
  sync();

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.dataset.ui = "GridTable.summaryApplyButton";
  submit.textContent = text.summaryApply;
  menu.append(fn, criteriaLabel, rangeLabel, submit);
  menu.addEventListener("submit", (event) => {
    event.preventDefault();
    const f = fn.value as SummaryFunction | "";
    const r = Number(range.value);
    apply(
      f === ""
        ? null
        : {
            fn: f,
            ...(f === "countif" || f === "sumif" ? { criteria: criteria.value.slice(0, MAX_CRITERIA_LENGTH) } : {}),
            ...(f === "sumif" && r !== col ? { range: r } : {}),
          },
    );
    close();
  });

  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
  document.body.append(menu);
  const onPointer = (event: PointerEvent) => {
    if (!menu.contains(event.target as globalThis.Node) && event.target !== anchor) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      anchor.focus();
    }
  };
  // Scrolling the page closes it (not scrolling inside it).
  const onScroll = (event: Event) => {
    if (!menu.contains(event.target as globalThis.Node)) close();
  };
  function close() {
    menu.remove();
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    if (openMenu?.close === close) openMenu = null;
  }
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  openMenu = { close };
  fn.focus();
}

class GridTableView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private scroll: HTMLElement;
  private bar: HTMLElement | null = null;
  private headerRow: HTMLInputElement | null = null;
  private headerColumn: HTMLInputElement | null = null;
  private summaryToggle: HTMLInputElement | null = null;
  // The summary row, under the rows (in the scrolling part, so its columns
  // line up with theirs); not part of the document.
  private summaryRow: HTMLElement;
  private text: GridText;
  private editable: boolean;
  private frame = 0;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    editor: Editor,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "kn-grid-table";
    this.dom.dataset.nodeType = "gridTable";
    this.dom.dataset.ui = "GridTable";
    this.text = gridText(editor);
    this.editable = editor.isEditable;
    if (editor.isEditable) this.dom.append(this.toolbar(this.text));
    this.scroll = document.createElement("div");
    this.scroll.className = "kn-grid-scroll";
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "kn-grid-body";
    this.contentDOM.setAttribute("role", "table");
    this.summaryRow = document.createElement("div");
    this.summaryRow.className = "kn-grid-summary";
    this.summaryRow.contentEditable = "false";
    this.summaryRow.dataset.ui = "GridTable.summaryRow";
    this.summaryRow.setAttribute("role", "row");
    this.scroll.append(this.contentDOM, this.summaryRow);
    this.dom.append(this.scroll);
    this.apply(node);
  }

  private toolbar(text: GridText): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "kn-grid-bar";
    bar.contentEditable = "false";
    bar.dataset.ui = "GridTable.toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", text.toolbar);
    const at = (run: (pos: number) => void) => () => {
      const pos = this.getPos();
      if (pos !== undefined) run(pos);
    };
    const headerRow = checkbox(text.headerRow, "GridTable.headerRowCheckbox", (checked) =>
      at((pos) => setTableAttr(this.view, pos, "headerRow", checked))(),
    );
    const headerColumn = checkbox(text.headerColumn, "GridTable.headerColumnCheckbox", (checked) =>
      at((pos) => setTableAttr(this.view, pos, "headerColumn", checked))(),
    );
    const summary = checkbox(text.summaryRow, "GridTable.summaryRowCheckbox", (checked) =>
      at((pos) => {
        const table = tableAt(this.view.state, pos);
        if (!table) return;
        setTableAttr(this.view, pos, "summary", checked ? serializeSummary(Array.from({ length: columnCount(table) }, () => null)) : "");
      })(),
    );
    this.headerRow = headerRow.input;
    this.headerColumn = headerColumn.input;
    this.summaryToggle = summary.input;
    bar.append(
      headerRow.dom,
      headerColumn.dom,
      summary.dom,
      button(`＋ ${text.addRow}`, "GridTable.addRowButton", at((pos) => insertRow(this.view, pos, Infinity))),
      button(`＋ ${text.addColumn}`, "GridTable.addColumnButton", at((pos) => insertColumn(this.view, pos, MAX_GRID_COLUMNS))),
      button(
        text.deleteTable,
        "GridTable.deleteButton",
        at(async (pos) => {
          if (await showConfirm(text.deleteTableConfirm, { danger: true })) deleteTable(this.view, pos);
        }),
      ),
    );
    this.bar = bar;
    return bar;
  }

  private apply(node: PMNode) {
    this.dom.dataset.id = String(node.attrs.id ?? "");
    this.dom.dataset.headerRow = String(node.attrs.headerRow === true);
    this.dom.dataset.headerColumn = String(node.attrs.headerColumn === true);
    const widths = gridWidths(node.attrs.widths, columnCount(node));
    this.contentDOM.style.setProperty("--kn-grid-columns", columnsTemplate(widths));
    if (this.headerRow) this.headerRow.checked = node.attrs.headerRow === true;
    if (this.headerColumn) this.headerColumn.checked = node.attrs.headerColumn === true;
    if (this.summaryToggle) this.summaryToggle.checked = !!node.attrs.summary;
    this.summaryRow.style.setProperty("--kn-grid-columns", columnsTemplate(widths));
    this.drawSummary(node);
    // Once ProseMirror has drawn the rows and cells.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.roles());
  }

  // Header cells read as headers (to screen readers too).
  private roles() {
    const headerRow = this.node.attrs.headerRow === true;
    const headerColumn = this.node.attrs.headerColumn === true;
    Array.from(this.contentDOM.children).forEach((row, r) => {
      Array.from(row.children)
        .filter((cell) => cell.classList.contains("kn-grid-cell"))
        .forEach((cell, c) => {
          const role = headerRow && r === 0 ? "columnheader" : headerColumn && c === 0 ? "rowheader" : "cell";
          if (cell.getAttribute("role") !== role) cell.setAttribute("role", role);
        });
    });
  }

  // The summary row: each column's value, worked out from the text of the
  // body's cells (the header row left out). An editor clicks a column's
  // cell to choose what it shows.
  private drawSummary(node: PMNode) {
    const columns = columnCount(node);
    const specs = parseSummary(node.attrs.summary, columns);
    this.summaryRow.hidden = !specs;
    this.dom.dataset.summary = String(!!specs);
    if (!specs) {
      this.summaryRow.replaceChildren();
      return;
    }
    const rows: string[][] = [];
    node.forEach((row, _offset, r) => {
      if (r === 0 && node.attrs.headerRow === true) return;
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cell.textBetween(0, cell.content.size, " ", " ")));
      rows.push(cells);
    });
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
    const cells = specs.map((spec, col) => {
      const cell = document.createElement(this.editable ? "button" : "div");
      cell.className = "kn-grid-summary-cell";
      cell.dataset.ui = "GridTable.summaryCell";
      cell.dataset.col = String(col);
      cell.setAttribute("role", "cell");
      const value = summaryValue(spec, rows, col);
      const label = document.createElement("span");
      label.className = "kn-grid-summary-fn";
      const shown = document.createElement("span");
      shown.className = "kn-grid-summary-value";
      shown.dataset.ui = "GridTable.summaryValue";
      if (spec) {
        label.textContent = this.text.summaryFunctions[spec.fn] + (spec.criteria ? ` ${spec.criteria}` : "");
        shown.textContent = value === null ? "–" : number.format(roundSummary(value));
      } else if (col === 0) {
        label.textContent = this.text.summaryLabel;
      }
      cell.append(label, shown);
      if (cell instanceof HTMLButtonElement) {
        cell.type = "button";
        cell.title = this.text.summaryMenu;
        cell.addEventListener("click", (event) => {
          event.preventDefault();
          this.chooseSummary(cell, col);
        });
      }
      return cell;
    });
    this.summaryRow.replaceChildren(...cells);
  }

  // A column's summary: the function, and for COUNTIF / SUMIF the condition
  // (and SUMIF's column to test it on).
  private chooseSummary(anchor: HTMLElement, col: number) {
    const pos = this.getPos();
    const table = pos === undefined ? null : tableAt(this.view.state, pos);
    if (pos === undefined || !table) return;
    const columns = columnCount(table);
    const specs = parseSummary(table.attrs.summary, columns) ?? Array.from({ length: columns }, () => null);
    showSummaryMenu(anchor, this.text, columns, col, specs[col], (spec) => {
      const now = this.getPos();
      const latest = now === undefined ? null : tableAt(this.view.state, now);
      if (now === undefined || !latest) return;
      const next = parseSummary(latest.attrs.summary, columnCount(latest)) ?? Array.from({ length: columnCount(latest) }, () => null);
      if (col >= next.length) return;
      next[col] = spec;
      setTableAttr(this.view, now, "summary", serializeSummary(next));
    });
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.apply(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as globalThis.Node;
    return !!this.bar?.contains(target) || this.summaryRow.contains(target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    if (this.bar?.contains(mutation.target)) return true;
    if (this.summaryRow.contains(mutation.target)) return true;
    return (
      mutation.type === "attributes" &&
      (mutation.target === this.dom || mutation.target === this.scroll || mutation.target === this.contentDOM)
    );
  }

  destroy() {
    cancelAnimationFrame(this.frame);
  }
}

class GridCellView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private controls: HTMLElement | null = null;

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    editor: Editor,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "kn-grid-cell";
    this.dom.dataset.nodeType = "gridCell";
    this.dom.dataset.ui = "GridTable.cell";
    this.dom.dataset.id = String(node.attrs.id ?? "");
    this.dom.setAttribute("role", "cell");
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "kn-grid-cell-content";
    this.dom.append(this.contentDOM);
    if (editor.isEditable) this.dom.append(this.makeControls(gridText(editor)));
  }

  private place() {
    const pos = this.getPos();
    return pos === undefined ? null : cellPlace(this.view.state, pos);
  }

  private makeControls(text: GridText): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "kn-grid-cell-controls";
    controls.contentEditable = "false";
    const menuButton = button("⋯", "GridTable.cellMenuButton", () => {
      const place = this.place();
      if (!place) return;
      const table = tableAt(this.view.state, place.tablePos);
      if (!table) return;
      const { tablePos, row, col } = place;
      const view = this.view;
      showCellMenu(menuButton, [
        { label: text.insertRowAbove, ui: "GridTable.insertRowAboveItem", run: () => insertRow(view, tablePos, row), disabled: table.childCount >= MAX_GRID_ROWS },
        { label: text.insertRowBelow, ui: "GridTable.insertRowBelowItem", run: () => insertRow(view, tablePos, row + 1), disabled: table.childCount >= MAX_GRID_ROWS },
        { label: text.insertColumnLeft, ui: "GridTable.insertColumnLeftItem", run: () => insertColumn(view, tablePos, col), disabled: columnCount(table) >= MAX_GRID_COLUMNS },
        { label: text.insertColumnRight, ui: "GridTable.insertColumnRightItem", run: () => insertColumn(view, tablePos, col + 1), disabled: columnCount(table) >= MAX_GRID_COLUMNS },
        { label: text.deleteRow, ui: "GridTable.deleteRowItem", run: () => deleteRow(view, tablePos, row), disabled: table.childCount <= 1 },
        { label: text.deleteColumn, ui: "GridTable.deleteColumnItem", run: () => deleteColumn(view, tablePos, col), disabled: columnCount(table) <= 1 },
      ]);
    });
    menuButton.className = "kn-grid-cell-menu-button";
    menuButton.setAttribute("aria-label", text.cellMenu);
    menuButton.setAttribute("aria-haspopup", "menu");

    const handle = document.createElement("div");
    handle.className = "kn-grid-resize";
    handle.dataset.ui = "GridTable.resizeHandle";
    handle.title = text.resize;
    handle.addEventListener("pointerdown", (event) => this.resize(event, handle));
    controls.append(menuButton, handle);
    this.controls = controls;
    return controls;
  }

  // Dragging the cell's right edge: this column and the next one share
  // their width differently; saved when let go.
  private resize(event: PointerEvent, handle: HTMLElement) {
    const place = this.place();
    const body = this.dom.parentElement?.parentElement;
    if (!place || !body?.classList.contains("kn-grid-body")) return;
    const firstRow = body.firstElementChild;
    const cells = Array.from(firstRow?.children ?? []).filter((c) => c.classList.contains("kn-grid-cell"));
    const { col, tablePos } = place;
    if (col >= cells.length - 1) return;
    event.preventDefault();
    const px = cells.map((c) => c.getBoundingClientRect().width);
    const pair = px[col] + px[col + 1];
    const startX = event.clientX;
    handle.setPointerCapture(event.pointerId);
    const widths = [...px];
    const move = (e: PointerEvent) => {
      const left = Math.min(pair - MIN_COLUMN_PX, Math.max(MIN_COLUMN_PX, px[col] + e.clientX - startX));
      widths[col] = left;
      widths[col + 1] = pair - left;
      body.style.setProperty("--kn-grid-columns", columnsTemplate(widths));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setTableAttr(this.view, tablePos, "widths", JSON.stringify(widths.map((w) => Math.round(w))));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "gridCell") return false;
    this.dom.dataset.id = String(node.attrs.id ?? "");
    return true;
  }

  stopEvent(event: Event): boolean {
    return !!this.controls?.contains(event.target as globalThis.Node);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    if (this.controls?.contains(mutation.target)) return true;
    return mutation.type === "attributes" && mutation.target === this.dom;
  }
}

type NodeConfig = Parameters<typeof Node.create>[0];

const GridTableNode = Node.create(GRID_TABLE_NODES.gridTable as NodeConfig).extend({
  addNodeView() {
    const editor = (this.options as { editor: Editor }).editor;
    return ({ node, view, getPos }) => new GridTableView(node, view, getPos, editor);
  },
});

const GridRowNode = Node.create(GRID_TABLE_NODES.gridRow as NodeConfig);

const GridCellNode = Node.create(GRID_TABLE_NODES.gridCell as NodeConfig).extend({
  addNodeView() {
    const editor = (this.options as { editor: Editor }).editor;
    return ({ node, view, getPos }) => new GridCellView(node, view, getPos, editor);
  },
});

export const gridTableBlock = createBlockSpecFromTiptapNode(
  { node: GridTableNode, type: "gridTable", content: "none" },
  GRID_TABLE_PROPS,
  [gridExtension],
);
export const gridRowBlock = createBlockSpecFromTiptapNode({ node: GridRowNode, type: "gridRow", content: "none" }, {});
export const gridCellBlock = createBlockSpecFromTiptapNode({ node: GridCellNode, type: "gridCell", content: "none" }, {});

// A new table: 3 × 3, the first row as headings.
export function newGridTable() {
  const cell = () => ({ type: "gridCell", children: [{ type: "paragraph" }] });
  const row = () => ({ type: "gridRow", children: [cell(), cell(), cell()] });
  return { type: "gridTable", props: { headerRow: true }, children: [row(), row(), row()] };
}
