import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { parseSummary, serializeSummary } from "./grid-summary";
import { moveColumnRule } from "./grid-types";
import { gridWidths } from "./grid-table-config";
import { copyTable } from "@/lib/clipboard-table";

// A column of the extended table, selected with its button at the top
// (grid-table-block.ts): text selection runs along the rows, so it can't take
// a column. Kept in this plugin's state, its cells marked; while one is
// selected, Ctrl/⌘+C copies it, Delete or Backspace empties its cells and Esc
// lets it go. It goes when the caret moves, or the table no longer has it.

export type SelectedColumn = { tablePos: number; col: number };

export const columnKey = new PluginKey<SelectedColumn | null>("knowlective-grid-column");

export function selectedColumn(state: EditorState): SelectedColumn | null {
  return columnKey.getState(state) ?? null;
}

export function selectColumn(view: EditorView, column: SelectedColumn | null) {
  view.dispatch(view.state.tr.setMeta(columnKey, column));
}

export function columnCount(table: PMNode): number {
  let n = 0;
  table.forEach((row) => {
    n = Math.max(n, row.childCount);
  });
  return n;
}

function tableAt(state: EditorState, tablePos: number): PMNode | null {
  const table = state.doc.nodeAt(tablePos);
  return table?.type.name === "gridTable" ? table : null;
}

// Each row's cell in the column: its position and node (rows without one left out).
function columnCells(table: PMNode, tablePos: number, col: number): { pos: number; cell: PMNode }[] {
  const out: { pos: number; cell: PMNode }[] = [];
  let rowPos = tablePos + 1;
  table.forEach((row) => {
    let cellPos = rowPos + 1;
    row.forEach((cell, _offset, index) => {
      if (index === col) out.push({ pos: cellPos, cell });
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  return out;
}

// The cells' texts (a line per paragraph).
function cellTexts(table: PMNode, tablePos: number, col: number): string[] {
  return columnCells(table, tablePos, col).map(({ cell }) => cell.textBetween(0, cell.content.size, "\n", "\n"));
}

// To the clipboard: a one-column table (lib/clipboard-table.ts) for other
// apps and this table's paste, and its lines as text.
export async function copyColumn(view: EditorView, column: SelectedColumn): Promise<void> {
  const table = tableAt(view.state, column.tablePos);
  if (!table) return;
  await copyTable(cellTexts(table, column.tablePos, column.col).map((t) => [t]));
}

// The column's cells emptied (each keeps one empty paragraph).
export function clearColumn(view: EditorView, column: SelectedColumn, newId: () => string) {
  const { state } = view;
  const table = tableAt(state, column.tablePos);
  if (!table) return;
  const { schema } = state;
  const tr = state.tr;
  for (const { pos, cell } of columnCells(table, column.tablePos, column.col).reverse()) {
    tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, schema.nodes.blockContainer.create({ id: newId() }, schema.nodes.paragraph.create()));
  }
  view.dispatch(tr.setMeta(columnKey, column));
}

// The column moved to `to` (its index once moved), with its width, summary
// and input rule.
export function moveColumn(view: EditorView, tablePos: number, from: number, to: number) {
  const { state } = view;
  const table = tableAt(state, tablePos);
  if (!table || from === to) return;
  const columns = columnCount(table);
  if (from < 0 || from >= columns || to < 0 || to >= columns) return;
  const reorder = <T>(list: T[]): T[] => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };
  const rows: PMNode[] = [];
  table.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((cell) => cells.push(cell));
    rows.push(row.type.create(row.attrs, from < cells.length && to < cells.length ? reorder(cells) : cells));
  });
  const attrs: Record<string, unknown> = { ...table.attrs, widths: JSON.stringify(reorder(gridWidths(table.attrs.widths, columns))) };
  const summary = parseSummary(table.attrs.summary, columns);
  if (summary) attrs.summary = serializeSummary(reorder(summary));
  if (table.attrs.columns) attrs.columns = moveColumnRule(table.attrs.columns, columns, from, to);
  const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, table.type.create(attrs, rows));
  tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1)));
  view.dispatch(tr.setMeta(columnKey, { tablePos, col: to }));
}

// A block style (BlockNote's textColor, backgroundColor or textAlignment) on
// every block in the column's cells that has it.
export function styleColumn(view: EditorView, column: SelectedColumn, attr: "textColor" | "backgroundColor" | "textAlignment", value: string) {
  const { state } = view;
  const table = tableAt(state, column.tablePos);
  if (!table) return;
  const tr = state.tr;
  for (const { pos, cell } of columnCells(table, column.tablePos, column.col)) {
    cell.descendants((node, offset) => {
      if (node.type.spec.attrs && attr in node.type.spec.attrs) tr.setNodeAttribute(pos + 1 + offset, attr, value);
    });
  }
  view.dispatch(tr.setMeta(columnKey, column));
}

export function columnPlugin(newId: () => string): Plugin<SelectedColumn | null> {
  return new Plugin<SelectedColumn | null>({
    key: columnKey,
    state: {
      init: () => null,
      apply: (tr, value, _old, state) => {
        const meta = tr.getMeta(columnKey) as SelectedColumn | null | undefined;
        if (meta !== undefined) return meta;
        if (!value) return null;
        if (tr.docChanged) {
          const mapped = tr.mapping.mapResult(value.tablePos);
          const table = mapped.deleted ? null : tableAt(state, mapped.pos);
          return table && value.col < columnCount(table) ? { tablePos: mapped.pos, col: value.col } : null;
        }
        return tr.selectionSet ? null : value;
      },
    },
    props: {
      decorations(state) {
        const column = selectedColumn(state);
        const table = column && tableAt(state, column.tablePos);
        if (!column || !table) return null;
        return DecorationSet.create(
          state.doc,
          columnCells(table, column.tablePos, column.col).map(({ pos, cell }) =>
            Decoration.node(pos, pos + cell.nodeSize, { class: "kn-grid-col-selected" }),
          ),
        );
      },
    },
    // Keys while a column is selected: on the document, as the focus may be
    // on its button rather than in the text. Not while a menu is open (its
    // keys are its own), nor in a field.
    view(view) {
      const onKey = (event: KeyboardEvent) => {
        const column = selectedColumn(view.state);
        if (!column || event.defaultPrevented) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest(".kn-grid-menu") || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        if (target && target !== document.body && !view.dom.contains(target)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          selectColumn(view, null);
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
          event.preventDefault();
          void copyColumn(view, column);
        } else if ((event.key === "Delete" || event.key === "Backspace") && view.editable) {
          event.preventDefault();
          clearColumn(view, column, newId);
        } else if (!["Shift", "Control", "Meta", "Alt"].includes(event.key)) {
          selectColumn(view, null);
        }
      };
      document.addEventListener("keydown", onKey, true);
      return { destroy: () => document.removeEventListener("keydown", onKey, true) };
    },
  });
}
