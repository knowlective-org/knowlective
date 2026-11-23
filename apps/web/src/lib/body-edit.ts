import * as Y from "yjs";
import { lockedBlockIds } from "./block-locks";

// Partial writes to a page's body (the MCP server, lib/mcp/): adding blocks
// at the end, and replacing one section (the blocks under a heading). There's
// deliberately no whole-body replace there: Markdown loses knowlective's own
// blocks, so an AI that reads a page and writes it back would turn them into
// plain text or drop them. For the same reason a section holding any block
// Markdown can't carry back unchanged (PLAIN_BLOCKS, below) isn't replaced.
//
// The body is the "blocknote" fragment: one blockGroup of top-level blocks —
// a blockContainer (its content node, then a blockGroup of nested blocks), or
// a columnList / gridTable. Only yjs here: the collab server runs these on the
// live document (server/collab.ts), and the unit tests on plain documents.

export const BODY_FIELD = "blocknote";

// Block types a Markdown round trip keeps as they are (headings without the
// toggle, code blocks without a preview). Anything else in a section — child
// page views, chats, masked text, diagrams, TODOs, files, toggles, columns,
// grid tables… — stops the replace.
const PLAIN_BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "quote",
  "codeBlock",
  "divider",
  "table",
  "image",
]);

export type SectionTarget = {
  // The heading's text (surrounding "#"s and spaces are ignored).
  heading: string;
  // 2 to 6, when several headings share the text.
  level?: number;
  // 1-based, among the headings that match, when there are still several.
  occurrence?: number;
};

export type SectionError =
  | { code: "heading_not_found" }
  | { code: "heading_ambiguous"; count: number }
  | { code: "custom_blocks"; types: string[] }
  | { code: "blocks_locked" };

// The top-level blockGroup, if the body has one.
function topGroup(doc: Y.Doc): Y.XmlElement | null {
  const first = doc.getXmlFragment(BODY_FIELD).toArray()[0];
  return first instanceof Y.XmlElement && first.nodeName === "blockGroup" ? first : null;
}

function contentOf(block: Y.XmlElement): Y.XmlElement | null {
  if (block.nodeName !== "blockContainer") return null;
  const first = block.toArray()[0];
  return first instanceof Y.XmlElement ? first : null;
}

// The plain text of a content node (inline nodes, such as mentions, skipped).
function textOf(content: Y.XmlElement): string {
  let text = "";
  for (const child of content.toArray()) {
    if (!(child instanceof Y.XmlText)) continue;
    for (const op of child.toDelta() as { insert: unknown }[]) {
      if (typeof op.insert === "string") text += op.insert;
    }
  }
  return text;
}

const normalizeHeading = (text: string) =>
  text.normalize("NFKC").replace(/^\s*#+\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();

function headingLevel(content: Y.XmlElement): number {
  const level = Number(content.getAttribute("level") ?? 2);
  return Number.isFinite(level) ? level : 2;
}

// The heading's position among the top-level blocks and the end of its
// section (exclusive): up to the next heading of the same or a higher level.
function findSection(
  group: Y.XmlElement,
  target: SectionTarget,
): { index: number; end: number } | SectionError {
  const blocks = group.toArray();
  const wanted = normalizeHeading(target.heading);
  const matches: number[] = [];
  blocks.forEach((block, i) => {
    if (!(block instanceof Y.XmlElement)) return;
    const content = contentOf(block);
    if (content?.nodeName !== "heading") return;
    if (target.level !== undefined && headingLevel(content) !== target.level) return;
    if (normalizeHeading(textOf(content)) === wanted) matches.push(i);
  });
  if (matches.length === 0) return { code: "heading_not_found" };
  let index: number;
  if (target.occurrence !== undefined) {
    if (target.occurrence < 1 || target.occurrence > matches.length) return { code: "heading_not_found" };
    index = matches[target.occurrence - 1];
  } else if (matches.length > 1) {
    return { code: "heading_ambiguous", count: matches.length };
  } else {
    index = matches[0];
  }
  const level = headingLevel(contentOf(blocks[index] as Y.XmlElement)!);
  let end = index + 1;
  for (; end < blocks.length; end++) {
    const block = blocks[end];
    const content = block instanceof Y.XmlElement ? contentOf(block) : null;
    if (content?.nodeName === "heading" && headingLevel(content) <= level) break;
  }
  return { index, end };
}

// A mention is an element beside the text nodes (in a table, inside its cells).
function holdsMention(node: Y.XmlElement): boolean {
  return node.toArray().some((child) => child instanceof Y.XmlElement && (child.nodeName === "mention" || holdsMention(child)));
}

// The block types in `node` and below that aren't plain (see PLAIN_BLOCKS),
// and whether there's an inline node (a mention) in its text.
function collectTypes(node: Y.XmlElement, out: Set<string>) {
  if (node.nodeName === "blockContainer") {
    const content = contentOf(node);
    if (content) {
      const type = content.nodeName;
      if (!PLAIN_BLOCKS.has(type)) out.add(type);
      else if (type === "heading" && (content.getAttribute("isToggleable") as unknown) === true) out.add("toggleHeading");
      else if (type === "codeBlock" && content.getAttribute("preview")) out.add("codePreview");
      if (holdsMention(content)) out.add("mention");
    }
  } else if (node.nodeName !== "blockGroup") {
    // columnList, gridTable…
    out.add(node.nodeName);
    return;
  }
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement && child !== contentOf(node)) collectTypes(child, out);
  }
}

function blockIds(node: Y.XmlElement, out: string[]) {
  const id = node.getAttribute("id");
  if (typeof id === "string") out.push(id);
  for (const child of node.toArray()) if (child instanceof Y.XmlElement) blockIds(child, out);
}

// The top-level blocks of `body` (a document holding only the fragment, as
// made from Markdown), copied for insertion into another document.
function newBlocks(body: Y.Doc): (Y.XmlElement | Y.XmlText)[] {
  const group = topGroup(body);
  return group ? group.toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone()) : [];
}

const isEmptyParagraph = (block: unknown) =>
  block instanceof Y.XmlElement &&
  block.length === 1 &&
  contentOf(block)?.nodeName === "paragraph" &&
  textOf(contentOf(block)!) === "";

// Adds `body`'s blocks at the end of the page. A page holding only an empty
// paragraph (a new page) gets them in its place.
export function appendBlocks(doc: Y.Doc, body: Y.Doc): void {
  const source = topGroup(body);
  if (!source || source.length === 0 || (source.length === 1 && isEmptyParagraph(source.get(0)))) return;
  const blocks = newBlocks(body);
  const group = topGroup(doc);
  if (!group) {
    // A page never opened in the editor: no body yet.
    const fragment = doc.getXmlFragment(BODY_FIELD);
    const created = new Y.XmlElement("blockGroup");
    fragment.insert(0, [created]);
    created.insert(0, blocks);
    return;
  }
  if (group.length === 1 && isEmptyParagraph(group.get(0))) {
    group.delete(0, 1);
    group.insert(0, blocks);
    return;
  }
  group.insert(group.length, blocks);
}

// What replacing the section would remove, or why it can't be replaced.
export function checkSection(doc: Y.Doc, target: SectionTarget): { index: number; end: number } | SectionError {
  const group = topGroup(doc);
  if (!group) return { code: "heading_not_found" };
  const found = findSection(group, target);
  if ("code" in found) return found;
  const heading = group.get(found.index) as Y.XmlElement;
  // The heading's nested blocks and the blocks after it are replaced.
  const replaced: Y.XmlElement[] = [];
  for (const child of heading.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName === "blockGroup") replaced.push(child);
  }
  for (let i = found.index + 1; i < found.end; i++) {
    const block = group.get(i);
    if (block instanceof Y.XmlElement) replaced.push(block);
  }
  const types = new Set<string>();
  collectTypes(heading, types);
  for (const block of replaced) collectTypes(block, types);
  if (types.size > 0) return { code: "custom_blocks", types: [...types].sort() };
  const locks = lockedBlockIds(doc);
  if (locks.size > 0) {
    const ids: string[] = [];
    for (const block of replaced) blockIds(block, ids);
    const headingId = heading.getAttribute("id");
    // The heading stays, but an "edit" lock covers what's nested in it.
    if (ids.some((id) => locks.has(id)) || (typeof headingId === "string" && locks.get(headingId) === "edit")) {
      return { code: "blocks_locked" };
    }
  }
  return found;
}

// Replaces the section under the heading (not the heading itself) with
// `body`'s blocks. Checked again here (checkSection): the live document may
// have changed since the caller looked.
export function replaceSection(doc: Y.Doc, target: SectionTarget, body: Y.Doc): SectionError | null {
  const found = checkSection(doc, target);
  if ("code" in found) return found;
  const group = topGroup(doc)!;
  const heading = group.get(found.index) as Y.XmlElement;
  for (let i = heading.length - 1; i >= 1; i--) {
    const child = heading.get(i);
    if (child instanceof Y.XmlElement && child.nodeName === "blockGroup") heading.delete(i, 1);
  }
  if (found.end > found.index + 1) group.delete(found.index + 1, found.end - found.index - 1);
  // Empty Markdown (one empty paragraph) leaves the heading alone.
  const source = topGroup(body);
  const empty = !source || (source.length === 1 && isEmptyParagraph(source.get(0)));
  if (!empty) group.insert(found.index + 1, newBlocks(body));
  return null;
}
