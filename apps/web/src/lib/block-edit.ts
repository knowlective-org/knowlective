import * as Y from "yjs";
import { type BlockLock, lockedBlockIds } from "./block-locks";
import { BODY_FIELD } from "./body-edit";
import { CHECKED, type GridColumn, normalizeCheckbox, normalizeDate, normalizeNumber, parseColumns, selectedOptions } from "../components/editor/grid-types";
import { parseVideoUrl } from "../components/editor/video-url";
import { safeHttpUrl } from "./safe-url";

// Changing one block of a page's body for the public API and MCP
// (lib/api/blocks.ts): its text, its settings (props), a block inserted beside
// it, or its removal. Only yjs here: the collab server runs these on the live
// document (server/collab.ts), and the unit tests on plain documents.
//
// A block's id, type and nested blocks stay when it's changed. Settings are an
// allowlist per type (EDITABLE_PROPS), each value checked: everything else
// (a file's URL, sealed text, a table's column rules, who ticked a TODO) can't
// be written. No dependencies but yjs (unit tests: test/block-edit.test.ts).

export type BlockEditError =
  | { code: "block_not_found" }
  | { code: "blocks_locked" }
  | { code: "no_text"; type: string }
  | { code: "not_one_block" }
  | { code: "empty_content" }
  | { code: "not_a_block"; type: string }
  | { code: "typed_cell" }
  | { code: "masked_cell" }
  | { code: "invalid_value" }
  | { code: "invalid_prop"; prop: string; type: string }
  | { code: "nothing_to_change" };

export type BlockEdit =
  | {
      kind: "update";
      blockId: string;
      // `text` as sent; `body` the same as Markdown (a Yjs update of a document
      // holding the BlockNote fragment). A code block takes the text as it is.
      content?: { text: string; body: Uint8Array };
      props?: Record<string, unknown>;
      // Who may be an assignee or a person cell (the page's people).
      people: string[];
      userId: string;
      now: string;
      // An id for a block this edit has to make (a cell's value).
      newId: string;
    }
  | { kind: "insert"; blockId: string; position: "before" | "after"; body: Uint8Array }
  | { kind: "delete"; blockId: string; newId: string };

// --- Settings ----------------------------------------------------------------

type Check = (value: unknown, people: string[]) => unknown;
// undefined: not a valid value.
const INVALID = undefined;

const oneOf = (...values: string[]): Check => (v) => (typeof v === "string" && values.includes(v) ? v : INVALID);
const flag: Check = (v) => (typeof v === "boolean" ? v : INVALID);
const shortText = (max: number): Check => (v) => (typeof v === "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v : INVALID);
const COLORS = ["default", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"];
const color = oneOf(...COLORS);
const align = oneOf("left", "center", "right", "justify");
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const idOrEmpty: Check = (v) => (v === "" || (typeof v === "string" && ID.test(v)) ? v : INVALID);
const sort: Check = (v) => (v === "" || (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}:(asc|desc)$/.test(v)) ? v : INVALID);
const httpOrEmpty: Check = (v) => {
  if (v === "") return v;
  return typeof v === "string" && v.length <= 2048 && safeHttpUrl(v) ? v : INVALID;
};
const videoUrl: Check = (v) => (typeof v === "string" && v.length <= 2048 && parseVideoUrl(v) ? v : INVALID);
const dueDate: Check = (v) => {
  if (typeof v !== "string") return INVALID;
  return normalizeDate(v) ?? INVALID;
};
const person: Check = (v, people) => (v === "" || (typeof v === "string" && people.includes(v)) ? v : INVALID);

const TEXT_STYLE = { textColor: color, backgroundColor: color, textAlignment: align };
const TITLE = shortText(500);

export const EDITABLE_PROPS: Record<string, Record<string, Check>> = {
  paragraph: TEXT_STYLE,
  heading: {
    ...TEXT_STYLE,
    level: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 2 && v <= 6 ? v : INVALID),
    isToggleable: flag,
  },
  bulletListItem: TEXT_STYLE,
  numberedListItem: { ...TEXT_STYLE, start: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1_000_000 ? v : INVALID) },
  checkListItem: { ...TEXT_STYLE, checked: flag },
  toggleListItem: TEXT_STYLE,
  quote: { textColor: color, backgroundColor: color },
  codeBlock: { language: (v) => (typeof v === "string" && /^[A-Za-z0-9+#._-]{1,40}$/.test(v) ? v : INVALID), preview: oneOf("", "below", "only") },
  image: { caption: shortText(2000), textAlignment: align },
  video: { caption: shortText(2000) },
  audio: { caption: shortText(2000) },
  file: { caption: shortText(2000) },
  todo: { checked: flag, assignee: person, due: dueDate },
  mermaid: { code: shortText(100_000) },
  pdf: { name: shortText(500) },
  videoEmbed: { url: videoUrl },
  linkPreview: { url: httpOrEmpty, title: shortText(500), description: shortText(2000), image: httpOrEmpty, siteName: shortText(200) },
  chat: { title: TITLE },
  whiteboard: { pageId: idOrEmpty },
  childPages: { title: TITLE, depth: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : INVALID), sort },
  childTable: { title: TITLE, sort, source: idOrEmpty },
  childBoard: { title: TITLE, groupBy: idOrEmpty, subGroupBy: idOrEmpty, sort, source: idOrEmpty },
  childCalendar: { title: TITLE, dateBy: idOrEmpty, source: idOrEmpty },
  gridTable: { headerRow: flag, headerColumn: flag },
};

const TEXT_TYPES = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "todo", "codeBlock"]);

// --- Finding a block ------------------------------------------------------------

type Found = { node: Y.XmlElement; ancestors: Y.XmlElement[] };

function findBlock(doc: Y.Doc, id: string): Found | null {
  const visit = (parent: Y.XmlElement | Y.XmlFragment, ancestors: Y.XmlElement[]): Found | null => {
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.getAttribute("id") === id) return { node: child, ancestors };
      const below = visit(child, [...ancestors, child]);
      if (below) return below;
    }
    return null;
  };
  return visit(doc.getXmlFragment(BODY_FIELD), []);
}

function contentOf(block: Y.XmlElement): Y.XmlElement | null {
  if (block.nodeName !== "blockContainer") return null;
  const first = block.toArray()[0];
  return first instanceof Y.XmlElement ? first : null;
}

const typeOf = (node: Y.XmlElement) => contentOf(node)?.nodeName ?? node.nodeName;

function hasIdIn(node: Y.XmlElement, locks: Map<string, BlockLock>): boolean {
  const id = node.getAttribute("id");
  if (typeof id === "string" && locks.has(id)) return true;
  return node.toArray().some((c) => c instanceof Y.XmlElement && hasIdIn(c, locks));
}

const editLocked = (nodes: Y.XmlElement[], locks: Map<string, BlockLock>) =>
  nodes.some((n) => {
    const id = n.getAttribute("id");
    return typeof id === "string" && locks.get(id) === "edit";
  });

type CellInfo = { rule: GridColumn | null; isHeader: boolean };

function cellInfo(cell: Y.XmlElement): CellInfo | null {
  const row = cell.parent;
  const table = row instanceof Y.XmlElement ? row.parent : null;
  if (!(row instanceof Y.XmlElement) || !(table instanceof Y.XmlElement) || table.nodeName !== "gridTable") return null;
  const rows = table.toArray();
  const width = Math.max(...rows.map((r) => (r as Y.XmlElement).length));
  const isHeader = rows[0] === row && (table.getAttribute("headerRow") as unknown) !== false;
  return { isHeader, rule: isHeader ? null : parseColumns(table.getAttribute("columns"), width)[row.toArray().indexOf(cell)] };
}

// Inside a cell of a typed column, blocks are its value's: changed through the cell.
const inTypedCell = (ancestors: Y.XmlElement[]) =>
  ancestors.some((a) => a.nodeName === "gridCell" && cellInfo(a)?.rule);

// --- Markdown bodies --------------------------------------------------------------

const bodyBlocks = (update: Uint8Array): Y.XmlElement[] => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const group = doc.getXmlFragment(BODY_FIELD).toArray()[0];
  return group instanceof Y.XmlElement ? (group.toArray() as Y.XmlElement[]) : [];
};

const isEmptyParagraph = (b: Y.XmlElement) => {
  const c = contentOf(b);
  return b.length === 1 && c?.nodeName === "paragraph" && c.toArray().every((n) => n instanceof Y.XmlText && n.toString() === "");
};

const clones = (nodes: unknown[]) => nodes.map((n) => (n as Y.XmlElement | Y.XmlText).clone());

function paragraphBlock(id: string, inline: (Y.XmlElement | Y.XmlText)[] = []): Y.XmlElement {
  const paragraph = new Y.XmlElement("paragraph");
  if (inline.length) paragraph.insert(0, inline);
  const block = new Y.XmlElement("blockContainer");
  block.setAttribute("id", id);
  block.insert(0, [paragraph]);
  return block;
}

const emptyParagraph = (id: string) => paragraphBlock(id);

// A cell's value as a paragraph: lines with hard breaks, or a mention.
function valueBlock(id: string, value: { text: string } | { userId: string }): Y.XmlElement {
  if ("userId" in value) {
    const mention = new Y.XmlElement("mention");
    mention.setAttribute("userId", value.userId);
    return paragraphBlock(id, [mention]);
  }
  const nodes: (Y.XmlElement | Y.XmlText)[] = [];
  value.text.split("\n").forEach((line, i) => {
    if (i > 0) nodes.push(new Y.XmlElement("hardBreak"));
    if (line) nodes.push(new Y.XmlText(line));
  });
  return paragraphBlock(id, nodes);
}

// A typed cell's value from what was sent; null when it isn't one.
function typedValue(text: string, rule: GridColumn, people: string[]): { text: string } | { userId: string } | null {
  const plain = (value: string | null) => (value === null ? null : { text: value });
  switch (rule.type) {
    case "number":
      return plain(normalizeNumber(text));
    case "date":
      return plain(normalizeDate(text));
    case "checkbox":
      return plain(normalizeCheckbox(text));
    case "select": {
      if (text.trim() === "") return { text: "" };
      const { names, unknown } = selectedOptions(text, rule);
      const given = text.split(/\n|,|、/).filter((p) => p.trim()).length;
      if (unknown.length > 0 || (!rule.multiple && given > 1)) return null;
      return { text: names.join("\n") };
    }
    case "user": {
      const id = text.trim().replace(/^<@(.+)>$/, "$1");
      if (id === "") return { text: "" };
      return people.includes(id) ? { userId: id } : null;
    }
    default:
      return null;
  }
}

// --- Plans -------------------------------------------------------------------

type Plan = BlockEditError | (() => void);

function planCell(cell: Y.XmlElement, edit: Extract<BlockEdit, { kind: "update" }>): Plan {
  if (edit.props && Object.keys(edit.props).length > 0) return { code: "invalid_prop", prop: Object.keys(edit.props)[0], type: "gridCell" };
  if (!edit.content) return { code: "nothing_to_change" };
  const info = cellInfo(cell);
  if (!info) return { code: "block_not_found" };
  if (info.rule?.type === "masked") return { code: "masked_cell" };
  if (info.rule) {
    const value = typedValue(edit.content.text, info.rule, edit.people);
    if (!value) return { code: "invalid_value" };
    return () => {
      cell.delete(0, cell.length);
      cell.insert(0, [valueBlock(edit.newId, value)]);
    };
  }
  const blocks = bodyBlocks(edit.content.body);
  return () => {
    cell.delete(0, cell.length);
    cell.insert(0, blocks.length > 0 ? clones(blocks) : [emptyParagraph(edit.newId)]);
  };
}

function setChecked(content: Y.XmlElement, checked: boolean, userId: string, now: string) {
  content.setAttribute("checked", checked as never);
  content.setAttribute("doneBy", checked ? userId : "");
  content.setAttribute("doneAt", checked ? now : "");
}

// Ticking a TODO ticks those nested in it (not ones already done, nor under
// an "edit" lock), as in the editor.
function tickNested(block: Y.XmlElement, locks: Map<string, BlockLock>, userId: string, now: string) {
  for (const group of block.toArray()) {
    if (!(group instanceof Y.XmlElement) || group.nodeName !== "blockGroup") continue;
    for (const child of group.toArray()) {
      if (!(child instanceof Y.XmlElement) || editLocked([child], locks)) continue;
      const content = contentOf(child);
      const done = content?.getAttribute("checked") as unknown;
      if (content?.nodeName === "todo" && done !== true && done !== "true") setChecked(content, true, userId, now);
      tickNested(child, locks, userId, now);
    }
  }
}

function planUpdate(found: Found, edit: Extract<BlockEdit, { kind: "update" }>, locks: Map<string, BlockLock>): Plan {
  const { node, ancestors } = found;
  if (editLocked([...ancestors, node], locks)) return { code: "blocks_locked" };
  if (inTypedCell(ancestors)) return { code: "typed_cell" };
  if (node.nodeName === "gridCell") return planCell(node, edit);
  const type = typeOf(node);
  const target = contentOf(node) ?? node;
  const props = edit.props ?? {};
  if (!edit.content && Object.keys(props).length === 0) return { code: "nothing_to_change" };

  const checked: [string, unknown][] = [];
  const allowed = EDITABLE_PROPS[type] ?? {};
  for (const [prop, value] of Object.entries(props)) {
    const check = Object.hasOwn(allowed, prop) ? allowed[prop] : null;
    const result = check ? check(value, edit.people) : INVALID;
    if (result === INVALID) return { code: "invalid_prop", prop, type };
    checked.push([prop, result]);
  }

  let newContent: unknown[] | null = null;
  if (edit.content) {
    if (type === "table") {
      const blocks = bodyBlocks(edit.content.body);
      const table = blocks.length === 1 ? contentOf(blocks[0]) : null;
      if (table?.nodeName !== "table") return { code: "not_one_block" };
      newContent = table.toArray();
    } else if (type === "codeBlock") {
      newContent = edit.content.text ? [new Y.XmlText(edit.content.text)] : [];
    } else if (TEXT_TYPES.has(type)) {
      const blocks = bodyBlocks(edit.content.body);
      if (blocks.length !== 1 || blocks[0].length !== 1) return { code: "not_one_block" };
      const source = contentOf(blocks[0]);
      if (!source || !TEXT_TYPES.has(source.nodeName)) return { code: "not_one_block" };
      newContent = source.toArray();
    } else {
      return { code: "no_text", type };
    }
  }

  return () => {
    if (newContent) {
      const inserted = type === "codeBlock" ? newContent : clones(newContent);
      target.delete(0, target.length);
      if (inserted.length) target.insert(0, inserted as (Y.XmlElement | Y.XmlText)[]);
    }
    for (const [prop, value] of checked) {
      if (type === "todo" && prop === "checked") {
        const was = target.getAttribute("checked") as unknown;
        if ((was === true || was === "true") !== value) setChecked(target, value as boolean, edit.userId, edit.now);
        if (value === true) tickNested(node, locks, edit.userId, edit.now);
      } else {
        target.setAttribute(prop, value as never);
      }
    }
  };
}

const MOVABLE = new Set(["blockContainer", "columnList", "gridTable"]);

function planInsert(found: Found, edit: Extract<BlockEdit, { kind: "insert" }>, locks: Map<string, BlockLock>): Plan {
  const { node, ancestors } = found;
  if (!MOVABLE.has(node.nodeName)) return { code: "not_a_block", type: node.nodeName };
  if (editLocked(ancestors, locks)) return { code: "blocks_locked" };
  if (inTypedCell(ancestors)) return { code: "typed_cell" };
  const blocks = bodyBlocks(edit.body);
  if (blocks.length === 0 || (blocks.length === 1 && isEmptyParagraph(blocks[0]))) return { code: "empty_content" };
  const parent = node.parent as Y.XmlElement;
  return () => {
    const index = parent.toArray().indexOf(node);
    parent.insert(edit.position === "before" ? index : index + 1, clones(blocks));
  };
}

function planDelete(found: Found, edit: Extract<BlockEdit, { kind: "delete" }>, locks: Map<string, BlockLock>): Plan {
  const { node, ancestors } = found;
  if (!MOVABLE.has(node.nodeName)) return { code: "not_a_block", type: node.nodeName };
  if (editLocked(ancestors, locks) || hasIdIn(node, locks)) return { code: "blocks_locked" };
  if (inTypedCell(ancestors)) return { code: "typed_cell" };
  const parent = node.parent as Y.XmlElement;
  return () => {
    const index = parent.toArray().indexOf(node);
    if (parent.length > 1) {
      parent.delete(index, 1);
      return;
    }
    // The last of a nested list goes with it; the page, a column and a cell
    // always keep a block.
    const holder = parent.parent;
    if (parent.nodeName === "blockGroup" && holder instanceof Y.XmlElement && holder.nodeName === "blockContainer") {
      holder.delete(holder.toArray().indexOf(parent), 1);
      return;
    }
    parent.insert(index + 1, [emptyParagraph(edit.newId)]);
    parent.delete(index, 1);
  };
}

function plan(doc: Y.Doc, edit: BlockEdit): Plan {
  const found = findBlock(doc, edit.blockId);
  if (!found) return { code: "block_not_found" };
  const locks = lockedBlockIds(doc);
  if (edit.kind === "update") return planUpdate(found, edit, locks);
  return edit.kind === "insert" ? planInsert(found, edit, locks) : planDelete(found, edit, locks);
}

// Why the edit can't be made, or null.
export function checkBlockEdit(doc: Y.Doc, edit: BlockEdit): BlockEditError | null {
  const planned = plan(doc, edit);
  return typeof planned === "function" ? null : planned;
}

// Makes the edit (checked again: the live document may have changed).
export function applyBlockEdit(doc: Y.Doc, edit: BlockEdit): BlockEditError | null {
  const planned = plan(doc, edit);
  if (typeof planned !== "function") return planned;
  planned();
  return null;
}

// --- Mentions in Markdown ---------------------------------------------------------

// "<@userId>" of the page's people survives the Markdown conversion as a mark
// in the private use area, and becomes a mention afterwards (restoreMentions).
const OPEN = "";
const CLOSE = "";

export function protectMentions(markdown: string, people: string[]): { markdown: string; ids: string[] } {
  const ids: string[] = [];
  const clean = markdown.replaceAll(OPEN, "").replaceAll(CLOSE, "");
  const protectedText = clean.replace(/<@([A-Za-z0-9_-]{1,64})>/g, (whole, id: string) => {
    if (!people.includes(id)) return whole;
    ids.push(id);
    return `${OPEN}${ids.length - 1}${CLOSE}`;
  });
  return { markdown: protectedText, ids };
}

export function restoreMentions(body: Uint8Array, ids: string[]): Uint8Array {
  if (ids.length === 0) return body;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, body);
  const mark = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");
  const literal = (text: string) => text.replace(mark, (_, n: string) => `<@${ids[Number(n)]}>`);
  const visit = (parent: Y.XmlElement | Y.XmlFragment) => {
    for (let i = parent.length - 1; i >= 0; i--) {
      const child = parent.get(i);
      if (child instanceof Y.XmlElement) {
        visit(child);
        continue;
      }
      if (!(child instanceof Y.XmlText) || !child.toString().includes(OPEN)) continue;
      const nodes: (Y.XmlElement | Y.XmlText)[] = [];
      const inCode = parent instanceof Y.XmlElement && parent.nodeName === "codeBlock";
      for (const op of child.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
        if (typeof op.insert !== "string") continue;
        const plainText = (text: string) => {
          if (!text) return;
          const t = new Y.XmlText();
          t.applyDelta([{ insert: text, ...(op.attributes ? { attributes: op.attributes } : {}) }]);
          nodes.push(t);
        };
        if (inCode || op.attributes?.code) {
          plainText(literal(op.insert));
          continue;
        }
        let at = 0;
        for (const m of op.insert.matchAll(mark)) {
          plainText(op.insert.slice(at, m.index));
          const mention = new Y.XmlElement("mention");
          mention.setAttribute("userId", ids[Number(m[1])]);
          nodes.push(mention);
          at = m.index + m[0].length;
        }
        plainText(op.insert.slice(at));
      }
      parent.delete(i, 1);
      if (nodes.length) parent.insert(i, nodes);
    }
  };
  doc.transact(() => visit(doc.getXmlFragment(BODY_FIELD)));
  return Y.encodeStateAsUpdate(doc);
}

// --- Reading -----------------------------------------------------------------

export type DocBlock = { id?: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: DocBlock[] };
export type ListedBlock = {
  id: string;
  type: string;
  parentId: string | null;
  depth: number;
  // Inline Markdown (mentions as <@userId>), what update_block takes back.
  text?: string;
  // Colors or underlines in the text, which Markdown doesn't carry: writing
  // the text back loses them.
  styledText?: true;
  rows?: string[][];
  // Only the settings that can be changed.
  props?: Record<string, unknown>;
  masked?: true;
  row?: number;
  column?: number;
  columnType?: string;
};

const escapeMarkdown = (text: string) => text.replace(/([\\`*_[\]~])/g, "\\$1");

function inlineMarkdown(content: unknown, flags: { styled: boolean }): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return "";
      const i = item as { type?: unknown; text?: unknown; href?: unknown; content?: unknown; styles?: Record<string, unknown>; props?: { userId?: unknown } };
      if (i.type === "mention") return typeof i.props?.userId === "string" ? `<@${i.props.userId}>` : "";
      if (i.type === "link") return `[${inlineMarkdown(i.content, flags)}](${String(i.href ?? "")})`;
      if (i.type !== "text" || typeof i.text !== "string") return "";
      const s = i.styles ?? {};
      if (s.underline || s.textColor || s.backgroundColor) flags.styled = true;
      if (s.code) return `\`${i.text}\``;
      let out = escapeMarkdown(i.text);
      if (!out.trim()) return out;
      if (s.bold) out = `**${out}**`;
      if (s.italic) out = `*${out}*`;
      if (s.strike) out = `~~${out}~~`;
      return out;
    })
    .join("");
}

function plainInline(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((i: { type?: string; text?: string; content?: unknown }) => (i?.type === "text" ? (i.text ?? "") : i?.type === "link" ? plainInline(i.content) : "")).join("");
}

function listedProps(block: DocBlock): Record<string, unknown> | undefined {
  const allowed = EDITABLE_PROPS[block.type];
  if (!allowed) return undefined;
  const entries = Object.keys(allowed).filter((p) => block.props?.[p] !== undefined).map((p) => [p, block.props![p]]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

// Every block of a page in document order, with its id, for finding the one
// to change. A masked block's or masked cell's sealed text is never included.
export function listBlocks(blocks: DocBlock[]): ListedBlock[] {
  const out: ListedBlock[] = [];
  const visit = (list: DocBlock[], parentId: string | null, depth: number) => {
    for (const b of list) {
      if (typeof b.id !== "string") continue;
      const entry: ListedBlock = { id: b.id, type: b.type, parentId, depth };
      const props = listedProps(b);
      if (props) entry.props = props;
      if (b.type === "maskedText") {
        entry.masked = true;
        out.push(entry);
        continue;
      }
      if (b.type === "codeBlock") entry.text = plainInline(b.content);
      else if (TEXT_TYPES.has(b.type)) {
        const flags = { styled: false };
        entry.text = inlineMarkdown(b.content, flags);
        if (flags.styled) entry.styledText = true;
      } else if (b.type === "table") {
        const rows = (b.content as { rows?: { cells?: unknown[] }[] } | undefined)?.rows ?? [];
        entry.rows = rows.map((r) =>
          (r.cells ?? []).map((c) => inlineMarkdown(Array.isArray(c) ? c : (c as { content?: unknown })?.content, { styled: false })),
        );
      }
      out.push(entry);
      if (b.type === "gridTable") {
        const rows = b.children ?? [];
        const width = Math.max(0, ...rows.map((r) => r.children?.length ?? 0));
        const rules = parseColumns(b.props?.columns, width);
        const header = b.props?.headerRow !== false;
        rows.forEach((row, r) => {
          (row.children ?? []).forEach((cell, c) => {
            if (typeof cell.id !== "string") return;
            const rule = header && r === 0 ? null : rules[c];
            const listed: ListedBlock = { id: cell.id, type: "gridCell", parentId: b.id!, depth: depth + 1, row: r, column: c, columnType: rule?.type ?? "text" };
            if (rule?.type === "masked") {
              if ((cell.children ?? []).some((x) => plainInline(x.content))) listed.masked = true;
              out.push(listed);
            } else if (rule?.type === "user") {
              listed.text = (cell.children ?? []).map((x) => inlineMarkdown(x.content, { styled: false })).join("");
              out.push(listed);
            } else if (rule) {
              const text = (cell.children ?? []).map((x) => plainInline(x.content)).join("\n");
              listed.text = rule.type === "checkbox" ? String(text === CHECKED) : text;
              out.push(listed);
            } else {
              out.push(listed);
              visit(cell.children ?? [], cell.id, depth + 2);
            }
          });
        });
        continue;
      }
      visit(b.children ?? [], b.id, depth + 1);
    }
  };
  visit(blocks, null, 0);
  return out;
}
