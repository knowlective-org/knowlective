import { UniqueID } from "@blocknote/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { SecretKeyring, parseSealed, secretTextSupported } from "@/lib/secret-text";
import { showAlert, showConfirm, showPassphrase, showPrompt } from "../dialog";
import { showNotice } from "../notice";
import { pagePeople } from "./page-people";
import {
  CHECKED,
  GRID_OPTION_COLORS,
  type GridColumn,
  MAX_GRID_OPTIONS,
  MAX_OPTION_NAME,
  cleanOptionName,
  convertTexts,
  isValidText,
  normalizeCheckbox,
  normalizeDate,
  formatNumber,
  normalizeNumber,
  parseColumns,
  selectedOptions,
  serializeColumns,
} from "./grid-types";

// The typed columns of extended tables in the editor (rules: grid-types.ts):
// each of their cells shows a control for its value instead of its blocks,
// and writes the value back as the cell's text (or a mention). The cells
// learn their column's rule from node decorations (a cell's node isn't
// touched when its table's rule changes, its decorations are); the
// passphrases of masked columns opened on this screen are kept in this
// plugin's state (memory only, never sent).

export type GridValueText = {
  columnType: string;
  numberGrouping: string;
  numberDecimals: string;
  numberDecimalsAsTyped: string;
  types: Record<"text" | "number" | "date" | "select" | "multiSelect" | "checkbox" | "user" | "masked", string>;
  convertConfirm: string;
  invalid: string;
  numberInvalid: string;
  clearValue: string;
  newOption: string;
  newOptionPrompt: string;
  optionExists: string;
  tooManyOptions: string;
  renameOption: string;
  renameOptionPrompt: string;
  deleteOption: string;
  deleteOptionConfirm: string;
  pickOption: string;
  choosePerson: string;
  noPeople: string;
  maskedShow: string;
  maskedHide: string;
  maskedEnter: string;
  maskedEnterTitle: string;
  maskedChoose: string;
  maskedChooseTitle: string;
  maskedWrong: string;
  maskedOpen: string;
  maskedUnsupported: string;
  maskedNeedUnlock: string;
  maskedPasteSkipped: string;
};

export type MenuItem = { label: string; ui: string; run: () => void; disabled?: boolean };
type Menu = (anchor: HTMLElement, items: MenuItem[]) => void;

const newId = (): string => UniqueID.options.generateID();
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

// --- Where things are ----------------------------------------------------------

function columnCount(table: PMNode): number {
  let n = 0;
  table.forEach((row) => {
    n = Math.max(n, row.childCount);
  });
  return n;
}

// The table's cells with their places (before each cell, its row and column).
function cellsOf(table: PMNode, tablePos: number): { pos: number; node: PMNode; row: number; col: number }[] {
  const out: { pos: number; node: PMNode; row: number; col: number }[] = [];
  let rowPos = tablePos + 1;
  table.forEach((row, _o, r) => {
    let cellPos = rowPos + 1;
    row.forEach((cell, _o2, c) => {
      out.push({ pos: cellPos, node: cell, row: r, col: c });
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  return out;
}

const isBody = (table: PMNode, row: number) => !(row === 0 && table.attrs.headerRow === true);

function findTable(state: EditorState, id: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "gridTable" && node.attrs.id === id) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

// The typed column of the cell holding `pos`, if it's a body cell of one.
export function typedCellAt(state: EditorState, pos: number): { column: GridColumn; cellPos: number } | null {
  const $pos = state.doc.resolve(pos);
  for (let d = $pos.depth; d > 2; d--) {
    if ($pos.node(d).type.name !== "gridCell") continue;
    const table = $pos.node(d - 2);
    if (table.type.name !== "gridTable") return null;
    const row = $pos.index(d - 2);
    const col = $pos.index(d - 1);
    const column = parseColumns(table.attrs.columns, columnCount(table))[col];
    return column && isBody(table, row) ? { column, cellPos: $pos.before(d) } : null;
  }
  return null;
}

// --- A cell's value --------------------------------------------------------------

// Its text: a line per paragraph (and per line break in one).
export function cellValueText(cell: PMNode): string {
  const lines: string[] = [];
  cell.descendants((node) => {
    if (!node.isTextblock) return true;
    let line = "";
    node.forEach((child) => {
      if (child.isText) line += child.text;
      else if (child.type.name === "hardBreak") line += "\n";
    });
    lines.push(line);
    return false;
  });
  return lines.join("\n").replace(/\n+$/, "");
}

// Whether it's text only: paragraphs, nothing in them but text and line breaks.
function onlyText(cell: PMNode): boolean {
  let ok = true;
  cell.descendants((node) => {
    if (!ok) return false;
    if (node.type.name === "blockContainer" || node.type.name === "gridCell") return true;
    if (node.type.name === "paragraph") {
      node.forEach((child) => {
        if (!child.isText && child.type.name !== "hardBreak") ok = false;
      });
      return false;
    }
    ok = false;
    return false;
  });
  return ok;
}

// The person a user cell names, "" for none, null when it holds anything else.
function cellUser(cell: PMNode): string | null {
  let user = "";
  let other = false;
  cell.descendants((node) => {
    if (node.type.name === "mention") {
      if (user) other = true;
      user = String(node.attrs.userId ?? "");
    } else if (node.isText && node.text?.trim()) other = true;
    else if (node.isBlock && !["blockContainer", "paragraph", "gridCell"].includes(node.type.name)) other = true;
    return true;
  });
  return other ? null : user;
}

type CellContent = string | { mention: string | null };

// The cell's content replaced by one paragraph holding the value (lines
// split by line breaks), keeping its first block's id.
function cellReplacement(state: EditorState, cell: PMNode, value: CellContent): PMNode {
  const { schema } = state;
  let inline: PMNode[] = [];
  if (typeof value === "string") {
    value.split("\n").forEach((line, i) => {
      if (i > 0) inline.push(schema.nodes.hardBreak.create());
      if (line) inline.push(schema.text(line));
    });
  } else if (value.mention) {
    inline = [schema.nodes.mention.create({ userId: value.mention })];
  }
  const firstId = cell.firstChild?.attrs.id || newId();
  return schema.nodes.gridCell.create(cell.attrs, schema.nodes.blockContainer.create({ id: firstId }, schema.nodes.paragraph.create(null, inline)));
}

function writeCell(view: EditorView, cellPos: number, value: CellContent, tr: Transaction = view.state.tr) {
  const cell = tr.doc.nodeAt(cellPos);
  if (cell?.type.name !== "gridCell") return;
  tr.replaceWith(cellPos, cellPos + cell.nodeSize, cellReplacement(view.state, cell, value));
  view.dispatch(tr);
}

// --- Masked columns' passphrases ------------------------------------------------

const valuesKey = new PluginKey<Map<string, SecretKeyring>>("knowlective-grid-values");

const ringKey = (tableId: string, col: number) => `${tableId}:${col}`;

export function columnRing(state: EditorState, tableId: string, col: number): SecretKeyring | undefined {
  return valuesKey.getState(state)?.get(ringKey(tableId, col));
}

function setRing(view: EditorView, key: string, ring: SecretKeyring | null) {
  view.dispatch(view.state.tr.setMeta(valuesKey, { key, ring }).setMeta("addToHistory", false));
}

// The column's sealed values (to try a passphrase on).
function maskedValues(table: PMNode, tablePos: number, col: number): string[] {
  return cellsOf(table, tablePos)
    .filter((c) => c.col === col && isBody(table, c.row))
    .map((c) => cellValueText(c.node))
    .filter((v) => parseSealed(v) !== null);
}

const asking = new Set<string>();

// Asks for the column's passphrase (a new one, typed twice, when it has no
// values yet) and keeps it for this screen. The key, or null (cancelled).
export async function unlockColumn(view: EditorView, tableId: string, col: number, text: GridValueText): Promise<SecretKeyring | null> {
  if (!secretTextSupported()) {
    await showAlert(text.maskedUnsupported);
    return null;
  }
  const key = ringKey(tableId, col);
  const existing = valuesKey.getState(view.state)?.get(key);
  if (existing) return existing;
  if (asking.has(key)) return null;
  asking.add(key);
  try {
    const table = findTable(view.state, tableId);
    const sample = table ? maskedValues(table.node, table.pos, col)[0] : undefined;
    let ring: SecretKeyring | null = null;
    const passphrase = sample
      ? await showPassphrase(text.maskedEnter, {
          title: text.maskedEnterTitle,
          confirmLabel: text.maskedOpen,
          check: async (typed) => {
            const candidate = new SecretKeyring(typed);
            try {
              await candidate.open(sample);
            } catch {
              return text.maskedWrong;
            }
            ring = candidate;
            return null;
          },
        })
      : await showPassphrase(text.maskedChoose, { title: text.maskedChooseTitle, repeat: true });
    if (!passphrase) return null;
    const opened: SecretKeyring = ring ?? new SecretKeyring(passphrase);
    setRing(view, key, opened);
    return opened;
  } finally {
    asking.delete(key);
  }
}

export function lockColumn(view: EditorView, tableId: string, col: number) {
  setRing(view, ringKey(tableId, col), null);
}

// --- The plugin ------------------------------------------------------------------

// The spec on each typed cell's decoration: its column's rule, where it is,
// and whether the column is open (masked): a change of any updates the cell.
export type CellSpec = { knGrid: string; column: GridColumn; tableId: string; col: number; open: boolean };

function decorations(state: EditorState): DecorationSet {
  const rings = valuesKey.getState(state);
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "gridTable") return true;
    const columns = parseColumns(node.attrs.columns, columnCount(node));
    if (!columns.some(Boolean)) return true;
    const tableId = String(node.attrs.id ?? "");
    for (const cell of cellsOf(node, pos)) {
      const column = columns[cell.col];
      if (!column || !isBody(node, cell.row)) continue;
      const open = !!rings?.has(ringKey(tableId, cell.col));
      const spec: CellSpec = { knGrid: `${JSON.stringify(column)}|${tableId}|${cell.col}|${open}`, column, tableId, col: cell.col, open };
      decos.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, { "data-col-type": column.type }, spec));
    }
    return true;
  });
  return DecorationSet.create(state.doc, decos);
}

// The typed cell the selection is in.
const selectionTyped = (state: EditorState) => typedCellAt(state, state.selection.from);

export function gridValuesPlugin(): Plugin {
  return new Plugin<Map<string, SecretKeyring>>({
    key: valuesKey,
    state: {
      init: () => new Map(),
      apply: (tr, rings) => {
        const meta = tr.getMeta(valuesKey) as { key: string; ring: SecretKeyring | null } | undefined;
        if (!meta) return rings;
        const next = new Map(rings);
        if (meta.ring) next.set(meta.key, meta.ring);
        else next.delete(meta.key);
        return next;
      },
    },
    props: {
      decorations,
      // A typed cell's blocks are hidden behind its control: nothing typed,
      // dropped or broken into them goes there.
      handleTextInput: (view) => !!selectionTyped(view.state),
      handleKeyDown: (view, event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        if (!(event.key.length === 1 || ["Backspace", "Delete", "Enter"].includes(event.key))) return false;
        const typed = selectionTyped(view.state);
        if (!typed) return false;
        // To the cell's control instead.
        const dom = view.nodeDOM(typed.cellPos);
        (dom instanceof HTMLElement ? dom.querySelector<HTMLElement>("[data-grid-value] input, [data-grid-value] button") : null)?.focus();
        return true;
      },
      handleDrop: (view, event) => {
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return !!at && !!typedCellAt(view.state, at.pos);
      },
    },
  });
}

// --- A typed cell's control -------------------------------------------------------

function pageIdHere(): string | null {
  return /\/pages\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? null;
}

export type CellContext = {
  view: EditorView;
  cellPos: () => number | undefined;
  cell: PMNode;
  spec: CellSpec;
  editable: boolean;
  text: GridValueText;
  menu: Menu;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ui?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (ui) node.dataset.ui = ui;
  return node;
}

function invalidMark(text: GridValueText, raw: string): HTMLElement {
  const mark = el("span", "kn-grid-invalid", "GridTable.invalidValue");
  mark.textContent = `⚠ ${raw}`;
  mark.title = fill(text.invalid, { text: raw });
  return mark;
}

// The control for a typed cell (the cell's blocks are hidden; a user cell
// shows its mention and a button to choose the person).
export function cellControl(ctx: CellContext): HTMLElement {
  const { spec, cell, editable, text } = ctx;
  const { column } = spec;
  const box = el("div", "kn-grid-value");
  box.contentEditable = "false";
  box.dataset.gridValue = column.type;
  const raw = cellValueText(cell);
  const write = (value: CellContent) => {
    const pos = ctx.cellPos();
    if (pos !== undefined) writeCell(ctx.view, pos, value);
  };
  const plain = onlyText(cell);

  switch (column.type) {
    case "number": {
      const input = el("input", "kn-grid-value-input", "GridTable.numberInput");
      input.type = "text";
      input.inputMode = "decimal";
      // Shown as the column formats it; as stored while typed into.
      const shown = () => formatNumber(input.value, column);
      input.value = formatNumber(raw, column);
      input.disabled = !editable;
      input.addEventListener("focus", () => {
        input.value = normalizeNumber(input.value.replace(/[^\d.\-+,\s]/g, "")) ?? input.value;
      });
      input.addEventListener("blur", () => {
        if (!input.hasAttribute("aria-invalid")) input.value = shown();
      });
      const commit = () => {
        const value = normalizeNumber(input.value);
        if (value === null) {
          input.setAttribute("aria-invalid", "true");
          input.title = text.numberInvalid;
          return;
        }
        input.removeAttribute("aria-invalid");
        input.removeAttribute("title");
        // Shown as stored (the field isn't drawn again while it has the focus).
        input.value = value;
        if (value !== raw || !plain) write(value);
      };
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          input.value = raw;
          input.removeAttribute("aria-invalid");
          input.blur();
        }
      });
      box.append(input);
      if (!plain || !isValidText(raw, column)) box.append(invalidMark(text, raw));
      break;
    }
    case "date": {
      const input = el("input", "kn-grid-value-input", "GridTable.dateInput");
      input.type = "date";
      input.value = normalizeDate(raw) ?? "";
      input.disabled = !editable;
      input.addEventListener("change", () => write(input.value));
      box.append(input);
      if (!plain || !isValidText(raw, column)) box.append(invalidMark(text, raw));
      break;
    }
    case "checkbox": {
      const input = el("input", "kn-grid-value-check", "GridTable.checkboxInput");
      input.type = "checkbox";
      input.checked = normalizeCheckbox(raw) === CHECKED;
      input.disabled = !editable;
      input.addEventListener("change", () => write(input.checked ? CHECKED : ""));
      box.append(input);
      if (!plain || !isValidText(raw, column)) box.append(invalidMark(text, raw));
      break;
    }
    case "select": {
      const { names, unknown } = selectedOptions(raw, column);
      const chips = el("button", "kn-grid-chips", "GridTable.selectButton");
      chips.type = "button";
      chips.disabled = !editable;
      chips.title = column.multiple ? text.types.multiSelect : text.types.select;
      for (const name of names) {
        const chip = el("span", "kn-grid-chip", "GridTable.option");
        chip.textContent = name;
        chip.style.background = column.options.find((o) => o.name === name)?.color ?? GRID_OPTION_COLORS[0];
        chips.append(chip);
      }
      if (names.length === 0) chips.append(Object.assign(el("span", "kn-grid-chip-empty"), { textContent: "—" }));
      chips.addEventListener("click", (event) => {
        event.preventDefault();
        const items: MenuItem[] = column.options.map((o) => ({
          label: `${names.includes(o.name) ? "✓ " : "   "}${o.name}`,
          ui: "GridTable.optionItem",
          run: () => {
            const next = column.multiple
              ? names.includes(o.name)
                ? names.filter((n) => n !== o.name)
                : column.options.map((x) => x.name).filter((n) => n === o.name || names.includes(n))
              : [o.name];
            write(next.join("\n"));
          },
        }));
        items.push({ label: text.clearValue, ui: "GridTable.clearOptionItem", run: () => write("") });
        items.push({ label: text.newOption, ui: "GridTable.newOptionItem", run: () => void addOption(ctx, names) });
        ctx.menu(chips, items);
      });
      box.append(chips);
      if (!plain || unknown.length > 0 || !isValidText(raw, column)) box.append(invalidMark(text, raw));
      break;
    }
    case "user": {
      const user = cellUser(cell);
      const pick = el("button", "kn-grid-user-button", "GridTable.userButton");
      pick.type = "button";
      pick.textContent = "▾";
      pick.title = text.choosePerson;
      pick.setAttribute("aria-label", text.choosePerson);
      pick.disabled = !editable;
      pick.addEventListener("click", async (event) => {
        event.preventDefault();
        const pageId = pageIdHere();
        const people = pageId ? await pagePeople(pageId) : null;
        if (!people) return void showNotice(text.noPeople);
        ctx.menu(pick, [
          ...people.map((p) => ({ label: `${p.id === user ? "✓ " : "   "}${p.name}`, ui: "GridTable.personItem", run: () => write({ mention: p.id }) })),
          { label: text.clearValue, ui: "GridTable.clearPersonItem", run: () => write({ mention: null }) },
        ]);
      });
      box.append(pick);
      if (user === null) box.append(invalidMark(text, raw));
      break;
    }
    case "masked": {
      const ring = spec.open ? columnRing(ctx.view.state, spec.tableId, spec.col) : undefined;
      if (!ring) {
        const show = el("button", "kn-grid-masked", "GridTable.maskedButton");
        show.type = "button";
        show.textContent = raw ? "🔒 ••••••" : "🔒";
        show.title = text.maskedShow;
        show.setAttribute("aria-label", text.maskedShow);
        // Reading needs no edit access: the passphrase is the key.
        show.disabled = !raw && !editable;
        show.addEventListener("click", (event) => {
          event.preventDefault();
          void unlockColumn(ctx.view, spec.tableId, spec.col, text);
        });
        box.append(show);
        if (raw && parseSealed(raw) === null) box.append(invalidMark(text, raw));
        break;
      }
      const input = el("input", "kn-grid-value-input", "GridTable.maskedInput");
      input.type = "text";
      input.disabled = true;
      input.autocomplete = "off";
      input.spellcheck = false;
      box.append(input);
      const opened = raw ? ring.open(raw) : Promise.resolve("");
      void opened.then(
        (value) => {
          input.value = value;
          input.disabled = !editable;
        },
        () => {
          // Another passphrase's (or not sealed): shown as such, not overwritten.
          box.append(invalidMark(text, "🔒"));
        },
      );
      input.addEventListener("change", async () => {
        const sealed = input.value ? await ring.seal(input.value) : "";
        write(sealed);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          input.dispatchEvent(new Event("change"));
        }
      });
      break;
    }
  }
  return box;
}

// --- Options and types ------------------------------------------------------------

function setColumn(view: EditorView, tableId: string, col: number, column: GridColumn | null, tr: Transaction = view.state.tr): Transaction | null {
  const table = findTable(view.state, tableId);
  if (!table) return null;
  const list = parseColumns(table.node.attrs.columns, columnCount(table.node));
  list[col] = column;
  return tr.setNodeAttribute(table.pos, "columns", serializeColumns(list));
}

async function addOption(ctx: CellContext, selected: string[]) {
  const { text, spec, view } = ctx;
  if (spec.column.type !== "select") return;
  if (spec.column.options.length >= MAX_GRID_OPTIONS) return void showAlert(text.tooManyOptions);
  const typed = await showPrompt(text.newOptionPrompt, { maxLength: MAX_OPTION_NAME });
  const name = typed === null ? "" : cleanOptionName(typed);
  if (!name) return;
  const table = findTable(view.state, spec.tableId);
  if (!table) return;
  const current = parseColumns(table.node.attrs.columns, columnCount(table.node))[spec.col];
  if (current?.type !== "select") return;
  if (current.options.some((o) => o.name === name)) return void showAlert(text.optionExists);
  const column = { ...current, options: [...current.options, { name, color: GRID_OPTION_COLORS[current.options.length % GRID_OPTION_COLORS.length] }] };
  const tr = setColumn(view, spec.tableId, spec.col, column);
  const pos = ctx.cellPos();
  if (!tr || pos === undefined) return;
  const value = column.multiple ? column.options.map((o) => o.name).filter((n) => n === name || selected.includes(n)) : [name];
  writeCell(view, pos, value.join("\n"), tr);
}

// The column's cells (body only), with their values as text.
function columnCells(table: PMNode, tablePos: number, col: number) {
  return cellsOf(table, tablePos).filter((c) => c.col === col && isBody(table, c.row));
}

// Renames (`to` a name) or deletes (`to` null) one of a select column's
// options, in the cells too.
export async function editOption(view: EditorView, tableId: string, col: number, text: GridValueText, mode: "rename" | "delete") {
  const table = findTable(view.state, tableId);
  const column = table && parseColumns(table.node.attrs.columns, columnCount(table.node))[col];
  if (!table || column?.type !== "select" || column.options.length === 0) return;
  const { showChoice } = await import("../dialog");
  const name = await showChoice(
    text.pickOption,
    column.options.map((o) => ({ value: o.name, label: o.name })),
  );
  if (!name) return;
  let to: string | null = null;
  if (mode === "rename") {
    const typed = await showPrompt(text.renameOptionPrompt, { value: name, maxLength: MAX_OPTION_NAME });
    to = typed === null ? "" : cleanOptionName(typed);
    if (!to || to === name) return;
    if (column.options.some((o) => o.name === to)) return void showAlert(text.optionExists);
  } else if (!(await showConfirm(fill(text.deleteOptionConfirm, { name }), { danger: true }))) return;
  const latest = findTable(view.state, tableId);
  const now = latest && parseColumns(latest.node.attrs.columns, columnCount(latest.node))[col];
  if (!latest || now?.type !== "select") return;
  const options = to ? now.options.map((o) => (o.name === name ? { ...o, name: to! } : o)) : now.options.filter((o) => o.name !== name);
  const next = { ...now, options };
  const tr = view.state.tr;
  // From the last cell up: replacing moves only what comes after.
  for (const cell of columnCells(latest.node, latest.pos, col).reverse()) {
    const lines = cellValueText(cell.node).split("\n");
    if (!lines.includes(name)) continue;
    const value = lines.flatMap((l) => (l === name ? (to ? [to] : []) : [l])).join("\n");
    tr.replaceWith(cell.pos, cell.pos + cell.node.nodeSize, cellReplacement(view.state, cell.node, value));
  }
  const table2 = tr.doc.nodeAt(latest.pos);
  if (!table2) return;
  const list = parseColumns(table2.attrs.columns, columnCount(table2));
  list[col] = next;
  view.dispatch(tr.setNodeAttribute(latest.pos, "columns", serializeColumns(list)));
}

// The column made of another type (`target`; null: text): its cells'
// contents turned into the new type's values. Those that can't be are left
// empty, after asking (how many). One change: undone at once.
export async function changeColumnType(view: EditorView, tableId: string, col: number, target: GridColumn | null, text: GridValueText, label: string) {
  const start = findTable(view.state, tableId);
  if (!start) return;
  const current = parseColumns(start.node.attrs.columns, columnCount(start.node))[col];
  if (JSON.stringify(current) === JSON.stringify(target)) return;
  const cells = columnCells(start.node, start.pos, col);

  // What the cells say, as text (masked ones opened, people by name).
  let texts = cells.map((c) => cellValueText(c.node));
  if (current?.type === "masked" && texts.some(Boolean)) {
    const ring = await unlockColumn(view, tableId, col, text);
    if (!ring) return;
    try {
      texts = await Promise.all(texts.map((t) => (t ? ring.open(t) : "")));
    } catch {
      return void showAlert(text.maskedWrong);
    }
  }
  const pageId = pageIdHere();
  const needPeople = current?.type === "user" || target?.type === "user";
  const people = needPeople && pageId ? ((await pagePeople(pageId)) ?? []) : [];
  if (current?.type === "user") {
    texts = cells.map((c) => {
      const id = cellUser(c.node);
      return id ? (people.find((p) => p.id === id)?.name ?? "") : cellValueText(c.node);
    });
  }

  // The new values: null where they can't be made.
  let values: (CellContent | null)[];
  let column = target;
  if (!target) {
    values = texts;
    // A user column's mentions stay mentions.
    if (current?.type === "user") values = cells.map((c, i) => (cellUser(c.node) ? null : texts[i]));
  } else if (target.type === "user") {
    values = texts.map((t) => {
      const name = t.trim().replace(/^@/, "");
      if (!name) return { mention: null };
      const person = people.find((p) => p.name === name);
      return person ? { mention: person.id } : null;
    });
  } else if (target.type === "masked") {
    if (texts.some(Boolean)) {
      if (!secretTextSupported()) return void showAlert(text.maskedUnsupported);
      const passphrase = await showPassphrase(text.maskedChoose, { title: text.maskedChooseTitle, repeat: true });
      if (!passphrase) return;
      const ring = new SecretKeyring(passphrase);
      values = await Promise.all(texts.map((t) => (t ? ring.seal(t) : "")));
      setRing(view, ringKey(tableId, col), ring);
    } else values = texts.map(() => "");
  } else {
    const converted = convertTexts(texts, target);
    values = converted.values;
    column = converted.column;
  }
  // Cells with more than text (pictures, lists…) lose it: counted as failing.
  const failing = cells.filter((c, i) => {
    if (!target) return false;
    const empty = texts[i].trim() === "" && onlyText(c.node);
    return !empty && (values[i] === null || (target.type !== "user" && current?.type !== "user" && !onlyText(c.node)));
  }).length;
  if (failing > 0 && !(await showConfirm(fill(text.convertConfirm, { n: failing, type: label }), { danger: true }))) return;

  // Written to the table as it is now (by the cells' ids).
  const latest = findTable(view.state, tableId);
  if (!latest) return;
  const byId = new Map(cells.map((c, i) => [String(c.node.attrs.id), values[i]]));
  const tr = view.state.tr;
  for (const cell of columnCells(latest.node, latest.pos, col).reverse()) {
    const value = byId.get(String(cell.node.attrs.id));
    if (value === undefined) continue;
    // Text: cells left as they are where they already are text (or a mention).
    if (!target && (value === null || (onlyText(cell.node) && current?.type !== "masked"))) continue;
    tr.replaceWith(cell.pos, cell.pos + cell.node.nodeSize, cellReplacement(view.state, cell.node, value ?? (target?.type === "user" ? { mention: null } : "")));
  }
  const table = tr.doc.nodeAt(latest.pos);
  if (!table) return;
  const list = parseColumns(table.attrs.columns, columnCount(table));
  list[col] = column;
  view.dispatch(tr.setNodeAttribute(latest.pos, "columns", serializeColumns(list)));
  if (current?.type === "masked" && target?.type !== "masked") lockColumn(view, tableId, col);
}

// Text pasted into a typed column (pasteIntoGrid): its value where it is
// one, else the text as it is (marked as not a value). Masked columns aren't
// pasted into: their values are sealed in the browser, one by one.
export function pastedValue(column: GridColumn | null, text: string): string | null {
  if (!column) return text;
  switch (column.type) {
    case "number":
      return normalizeNumber(text) ?? text;
    case "date":
      return normalizeDate(text) ?? text;
    case "checkbox":
      return normalizeCheckbox(text) ?? text;
    case "select": {
      const { names, unknown } = selectedOptions(text, column);
      return unknown.length ? text : names.join("\n");
    }
    case "masked":
      return null;
    default:
      return text;
  }
}
