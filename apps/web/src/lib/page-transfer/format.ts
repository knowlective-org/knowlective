import { createHmac } from "node:crypto";
import * as Y from "yjs";
import { TITLE_FIELD } from "../page-title";
import { BLOCK_LOCKS_FIELD } from "../block-locks";
import { SLIDE_FIELD, TEXT_FIELDS, WHITEBOARD_FIELD } from "../whiteboard";

// What one site hands another when pages are copied (lib/page-transfer/):
// the pages of a subtree, each one's document, its child page table columns
// and values, a presentation's settings and its slides' notes, and the
// attachments to fetch next. The same form for a copy on one site.
//
// Each document is rebuilt into a fresh Y.Doc (rebuildState): the page's own
// state can carry deleted content and edit history, which a copy must not
// take along. Block ids, block locks, the whiteboard and a slide's background
// stay as they are; ids that change with the copy (pages, columns and files
// copied with it, people) are rewritten in attributes and marks, never in
// the text people wrote.
//
// No dependencies but Yjs: tested in Node (test/page-transfer.test.ts). A
// bundle from another site is checked here (parseBundle) before anything in
// it is used, and its documents again by the editor's own reading.

export const TRANSFER_FORMAT = "knowlective-pages";
export const TRANSFER_VERSION = 1;

// At most this many pages in one copy (a presentation's slides count).
export const MAX_TRANSFER_PAGES = 500;
// At most this many attachments in one copy.
export const MAX_TRANSFER_FILES = 1000;
// The bundle's JSON (without the files, fetched one by one).
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export const TRANSFER_KINDS = ["DOCUMENT", "WHITEBOARD", "SHORTCUT", "PRESENTATION", "SLIDE"] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];
export const PROPERTY_TYPES = ["TEXT", "LONG_TEXT", "DATE", "USER", "SELECT", "MASKED"] as const;
export type TransferPropertyType = (typeof PROPERTY_TYPES)[number];

export type TransferColumn = {
  id: string;
  type: TransferPropertyType;
  name: string;
  // SELECT: [{ id, name, color }], as stored (values name the option ids).
  options: unknown[];
  position: number;
};

export type TransferPresentation = {
  numberingEnabled: boolean;
  numberStart: number;
  numberPosition: string;
  hiddenSlideIds: string[];
  numberHiddenSlideIds: string[];
};

export type TransferPage = {
  id: string;
  // Within the bundle; null for the page the copy is of (always the first).
  parentId: string | null;
  kind: TransferKind;
  title: string;
  // SHORTCUT: the page it opens.
  shortcutTargetId: string | null;
  // The rebuilt document (base64 Yjs update); null for a page never opened.
  state: string | null;
  // The columns of its child page table.
  columns: TransferColumn[];
  // Its values in its parent's columns (by the parent's column ids).
  values: { defId: string; value: string }[];
  // PRESENTATION: its settings. SLIDE: its speaker notes (only when the one
  // exporting could edit the presentation).
  presentation: TransferPresentation | null;
  note: string | null;
};

export type TransferFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  // The page it belongs to, when that page is in the copy.
  pageId: string | null;
};

// Someone the pages name (mentions, TODO assignees, user columns): their
// address only as personHash(), so that the other site can find its own
// account with the same one and nobody's address leaves the site.
export type TransferPerson = { id: string; emailHash: string | null };

export type TransferBundle = {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  // The exporting site's public URL (origin and base path).
  site: string;
  exportedAt: string;
  // For personHash(): new with each export, so hashes can't be compared
  // across exports.
  salt: string;
  pages: TransferPage[];
  files: TransferFile[];
  people: TransferPerson[];
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ID_CHARS = "A-Za-z0-9_-";
const MAX_STATE_CHARS = 32 * 1024 * 1024;
const MAX_TITLE_CHARS = 1000;
const MAX_NOTE_CHARS = 20_000;
const MAX_VALUE_CHARS = 20_000;
const MAX_COLUMN_CHARS = 200;
const MAX_COLUMNS = 30;

export const isTransferId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

// An address as the other site compares it: keyed with the export's salt.
export function personHash(salt: string, email: string): string {
  return createHmac("sha256", salt).update(email.trim().toLowerCase()).digest("hex");
}

// ---- Rewriting ids ----------------------------------------------------------

export type Remap = {
  // Old id -> new id: pages, columns and files copied along. Replaced
  // wherever an attribute names one (a link's "/pages/<id>", a linked view's
  // source, a column id in a block's settings, "/api/files/<id>").
  ids: ReadonlyMap<string, string>;
  // People: old id -> the account here, or null for nobody (removed). Only
  // where a person is named (a mention, a TODO's assignee and who did it); a
  // person not in the map stays as they are (a copy on the same site).
  people: ReadonlyMap<string, string | null>;
};

export const NO_REMAP: Remap = { ids: new Map(), people: new Map() };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Replaces the ids in a string: whole ids only (not inside a longer one).
export function idReplacer(ids: ReadonlyMap<string, string>): (s: string) => string {
  if (ids.size === 0) return (s) => s;
  const keys = [...ids.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`(?<![${ID_CHARS}])(?:${keys.join("|")})(?![${ID_CHARS}])`, "g");
  return (s) => (s.length < 8 ? (ids.get(s) ?? s) : s.replace(pattern, (m) => ids.get(m) ?? m));
}

function deepMap(value: unknown, mapString: (s: string) => string, depth = 0): unknown {
  if (typeof value === "string") return mapString(value);
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map((v) => deepMap(v, mapString, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepMap(v, mapString, depth + 1)]));
}

// Where a person is named, by element and attribute.
const PERSON_ATTRIBUTES: Record<string, readonly string[]> = {
  mention: ["userId"],
  todo: ["assignee", "doneBy"],
};

// Each person named in a document (mentions, TODOs), in order.
export function peopleIn(doc: Y.Doc): string[] {
  const found = new Set<string>();
  const visit = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment) => {
    if (node instanceof Y.XmlText) return;
    if (node instanceof Y.XmlElement) {
      for (const attribute of PERSON_ATTRIBUTES[node.nodeName] ?? []) {
        const id = node.getAttribute(attribute) as unknown;
        if (isTransferId(id)) found.add(id);
      }
    }
    for (const child of node.toArray()) visit(child as Y.XmlElement | Y.XmlText);
  };
  visit(doc.getXmlFragment("blocknote"));
  return [...found];
}

type Delta = { insert: unknown; attributes?: Record<string, unknown> }[];

function copyNode(node: Y.XmlElement | Y.XmlText, mapString: (s: string) => string, remap: Remap): Y.XmlElement | Y.XmlText | null {
  if (node instanceof Y.XmlText) {
    const text = new Y.XmlText();
    const delta = (node.toDelta() as Delta).map((op) => ({
      insert: op.insert,
      ...(op.attributes && { attributes: deepMap(op.attributes, mapString) as Record<string, unknown> }),
    }));
    text.applyDelta(delta);
    return text;
  }
  const people = PERSON_ATTRIBUTES[node.nodeName] ?? [];
  const element = new Y.XmlElement(node.nodeName);
  for (const [key, value] of Object.entries(node.getAttributes() as Record<string, unknown>)) {
    if (people.includes(key) && typeof value === "string" && remap.people.has(value)) {
      const person = remap.people.get(value) ?? null;
      // Someone the other site doesn't have: no mention of nobody.
      if (person === null && node.nodeName === "mention") return null;
      element.setAttribute(key, person ?? "");
      continue;
    }
    element.setAttribute(key, deepMap(value, mapString) as string);
  }
  const children: (Y.XmlElement | Y.XmlText)[] = [];
  for (const child of node.toArray()) {
    const copy = copyNode(child as Y.XmlElement | Y.XmlText, mapString, remap);
    if (copy) children.push(copy);
  }
  element.insert(0, children);
  return element;
}

function copyMap(from: Y.Map<unknown>, to: Y.Map<unknown>, map: (key: string, value: unknown) => unknown) {
  for (const [key, value] of from) {
    // Only plain values are kept in these maps; anything else isn't ours.
    if (value instanceof Y.AbstractType) continue;
    to.set(key, map(key, value));
  }
}

// The document as a fresh one: the title, the body, the whiteboard, a slide's
// background and the block locks as they are now, with ids rewritten.
export function rebuildDoc(source: Y.Doc, remap: Remap = NO_REMAP): Y.Doc {
  const mapString = idReplacer(remap.ids);
  const target = new Y.Doc();
  target.transact(() => {
    const body: (Y.XmlElement | Y.XmlText)[] = [];
    for (const node of source.getXmlFragment("blocknote").toArray()) {
      const copy = copyNode(node as Y.XmlElement | Y.XmlText, mapString, remap);
      if (copy) body.push(copy);
    }
    target.getXmlFragment("blocknote").insert(0, body);
    target.getText(TITLE_FIELD).insert(0, source.getText(TITLE_FIELD).toString());

    const items = target.getMap<Y.Map<unknown>>(WHITEBOARD_FIELD);
    for (const [id, value] of source.getMap<unknown>(WHITEBOARD_FIELD)) {
      if (!(value instanceof Y.Map)) continue;
      const item = new Y.Map<unknown>();
      // What people wrote (and its marks) stays; links, images and the like
      // are rewritten.
      copyMap(value, item, (key, field) =>
        (TEXT_FIELDS as readonly string[]).includes(key) || key.endsWith("Marks") ? field : deepMap(field, mapString),
      );
      items.set(mapString(id), item);
    }
    copyMap(source.getMap<unknown>(SLIDE_FIELD), target.getMap<unknown>(SLIDE_FIELD), (_, v) => deepMap(v, mapString));
    copyMap(source.getMap<unknown>(BLOCK_LOCKS_FIELD), target.getMap<unknown>(BLOCK_LOCKS_FIELD), (_, v) => v);
  });
  return target;
}

export function rebuildState(update: Uint8Array, remap: Remap = NO_REMAP): Uint8Array {
  const source = new Y.Doc();
  try {
    Y.applyUpdate(source, update);
    const target = rebuildDoc(source, remap);
    const state = Y.encodeStateAsUpdate(target);
    target.destroy();
    return state;
  } finally {
    source.destroy();
  }
}

// ---- Reading a bundle --------------------------------------------------------

const isString = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

function parseColumn(raw: unknown): TransferColumn | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!isTransferId(c.id) || !isOneOf(PROPERTY_TYPES, c.type) || !isString(c.name, MAX_COLUMN_CHARS)) return null;
  if (!Array.isArray(c.options) || c.options.length > 100) return null;
  if (typeof c.position !== "number" || !Number.isInteger(c.position) || c.position < 0 || c.position > 10_000) return null;
  return { id: c.id, type: c.type, name: c.name, options: c.options, position: c.position };
}

function parseIdList(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_TRANSFER_PAGES) return null;
  return raw.every(isTransferId) ? [...raw] : null;
}

function parsePresentation(raw: unknown): TransferPresentation | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const hidden = parseIdList(p.hiddenSlideIds);
  const numberHidden = parseIdList(p.numberHiddenSlideIds);
  if (typeof p.numberingEnabled !== "boolean" || typeof p.numberStart !== "number" || !isString(p.numberPosition, 20)) return undefined;
  if (!hidden || !numberHidden) return undefined;
  return {
    numberingEnabled: p.numberingEnabled,
    numberStart: p.numberStart,
    numberPosition: p.numberPosition,
    hiddenSlideIds: hidden,
    numberHiddenSlideIds: numberHidden,
  };
}

function parsePage(raw: unknown): TransferPage | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!isTransferId(p.id) || !(p.parentId === null || isTransferId(p.parentId))) return null;
  if (!isOneOf(TRANSFER_KINDS, p.kind) || !isString(p.title, MAX_TITLE_CHARS)) return null;
  if (!(p.shortcutTargetId === null || isTransferId(p.shortcutTargetId))) return null;
  if (!(p.state === null || (isString(p.state, MAX_STATE_CHARS) && /^[A-Za-z0-9+/]*={0,2}$/.test(p.state)))) return null;
  if (!Array.isArray(p.columns) || p.columns.length > MAX_COLUMNS) return null;
  const columns = p.columns.map(parseColumn);
  if (columns.some((c) => c === null)) return null;
  if (!Array.isArray(p.values) || p.values.length > MAX_COLUMNS) return null;
  const values: TransferPage["values"] = [];
  for (const v of p.values as unknown[]) {
    if (!v || typeof v !== "object") return null;
    const { defId, value } = v as Record<string, unknown>;
    if (!isTransferId(defId) || !isString(value, MAX_VALUE_CHARS)) return null;
    values.push({ defId, value });
  }
  const presentation = parsePresentation(p.presentation);
  if (presentation === undefined) return null;
  if (!(p.note === null || isString(p.note, MAX_NOTE_CHARS))) return null;
  return {
    id: p.id,
    parentId: p.parentId,
    kind: p.kind,
    title: p.title,
    shortcutTargetId: p.kind === "SHORTCUT" ? p.shortcutTargetId : null,
    state: p.kind === "SHORTCUT" ? null : p.state,
    columns: columns as TransferColumn[],
    values,
    presentation: p.kind === "PRESENTATION" ? presentation : null,
    note: p.kind === "SLIDE" ? p.note : null,
  };
}

function parseFile(raw: unknown): TransferFile | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (!isTransferId(f.id) || !isString(f.name, 255) || f.name === "" || !isString(f.mimeType, 255)) return null;
  if (typeof f.size !== "number" || !Number.isInteger(f.size) || f.size < 0) return null;
  if (!(f.pageId === null || isTransferId(f.pageId))) return null;
  return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, pageId: f.pageId };
}

// Why a bundle was refused (for the one importing it).
export type BundleProblem = "format" | "too_many_pages" | "too_many_files" | "tree";

// The bundle if it's one this version reads and its pages make one tree: the
// first page is the top, every other page's parent comes before it, a slide
// is only in a presentation and a presentation holds only slides, and
// nothing is under a shortcut.
export function parseBundle(raw: unknown): TransferBundle | { problem: BundleProblem } {
  if (!raw || typeof raw !== "object") return { problem: "format" };
  const b = raw as Record<string, unknown>;
  if (b.format !== TRANSFER_FORMAT || b.version !== TRANSFER_VERSION) return { problem: "format" };
  if (!isString(b.site, 2000) || !isString(b.exportedAt, 64) || !isString(b.salt, 200) || b.salt.length < 16) return { problem: "format" };
  if (!Array.isArray(b.pages) || !Array.isArray(b.files) || !Array.isArray(b.people)) return { problem: "format" };
  if (b.pages.length === 0) return { problem: "tree" };
  if (b.pages.length > MAX_TRANSFER_PAGES) return { problem: "too_many_pages" };
  if (b.files.length > MAX_TRANSFER_FILES) return { problem: "too_many_files" };
  if (b.people.length > 10_000) return { problem: "format" };

  const pages: TransferPage[] = [];
  const kindOf = new Map<string, TransferKind>();
  for (const [i, raw] of (b.pages as unknown[]).entries()) {
    const page = parsePage(raw);
    if (!page) return { problem: "format" };
    if (kindOf.has(page.id)) return { problem: "tree" };
    if ((i === 0) !== (page.parentId === null)) return { problem: "tree" };
    if (page.parentId !== null) {
      const parentKind = kindOf.get(page.parentId);
      if (!parentKind || parentKind === "SHORTCUT" || parentKind === "SLIDE") return { problem: "tree" };
      if ((parentKind === "PRESENTATION") !== (page.kind === "SLIDE")) return { problem: "tree" };
    } else if (page.kind === "SLIDE") {
      return { problem: "tree" };
    }
    kindOf.set(page.id, page.kind);
    pages.push(page);
  }

  const files: TransferFile[] = [];
  const fileIds = new Set<string>();
  for (const raw of b.files as unknown[]) {
    const file = parseFile(raw);
    if (!file || fileIds.has(file.id)) return { problem: "format" };
    fileIds.add(file.id);
    files.push(file);
  }

  const people: TransferPerson[] = [];
  for (const raw of b.people as unknown[]) {
    if (!raw || typeof raw !== "object") return { problem: "format" };
    const { id, emailHash } = raw as Record<string, unknown>;
    if (!isTransferId(id) || !(emailHash === null || (typeof emailHash === "string" && /^[0-9a-f]{64}$/.test(emailHash)))) {
      return { problem: "format" };
    }
    people.push({ id, emailHash });
  }

  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    site: b.site,
    exportedAt: b.exportedAt,
    salt: b.salt,
    pages,
    files,
    people,
  };
}
