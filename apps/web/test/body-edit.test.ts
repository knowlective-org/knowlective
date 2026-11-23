import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { appendBlocks, checkSection, replaceSection } from "../src/lib/body-edit";
import { BLOCK_LOCKS_FIELD } from "../src/lib/block-locks";

// Partial writes from the MCP server (lib/body-edit.ts): adding at the end,
// and replacing one section — refused when the section holds blocks Markdown
// can't carry back unchanged, or locked blocks.

type Spec = { id: string; type: string; text?: string; level?: number; attrs?: Record<string, unknown>; mention?: boolean; nested?: Spec[] };

// BlockNote's shape: blockGroup > blockContainer(id) > content node (+ a
// blockGroup of nested blocks). columnList stands for a block without a
// container.
function fill(group: Y.XmlElement, specs: Spec[]) {
  for (const spec of specs) {
    if (spec.type === "columnList") {
      const columns = new Y.XmlElement("columnList");
      group.insert(group.length, [columns]);
      columns.setAttribute("id", spec.id);
      continue;
    }
    const container = new Y.XmlElement("blockContainer");
    group.insert(group.length, [container]);
    container.setAttribute("id", spec.id);
    const content = new Y.XmlElement(spec.type);
    container.insert(0, [content]);
    if (spec.level) content.setAttribute("level", spec.level as never);
    for (const [k, v] of Object.entries(spec.attrs ?? {})) content.setAttribute(k, v as never);
    const text = new Y.XmlText();
    content.insert(0, [text]);
    text.insert(0, spec.text ?? "");
    // As y-prosemirror stores an inline node: an element beside the text.
    if (spec.mention) content.insert(content.length, [new Y.XmlElement("mention")]);
    if (spec.nested) {
      const nested = new Y.XmlElement("blockGroup");
      container.insert(1, [nested]);
      fill(nested, spec.nested);
    }
  }
}

function docOf(specs: Spec[]): Y.Doc {
  const doc = new Y.Doc();
  const group = new Y.XmlElement("blockGroup");
  doc.getXmlFragment("blocknote").insert(0, [group]);
  fill(group, specs);
  return doc;
}

// The top-level blocks as "type:text" (nested ones in brackets).
function outline(doc: Y.Doc): string[] {
  const group = doc.getXmlFragment("blocknote").get(0) as Y.XmlElement;
  const line = (node: Y.XmlElement): string => {
    if (node.nodeName !== "blockContainer") return node.nodeName;
    const [content, nested] = node.toArray() as Y.XmlElement[];
    const text = (content.get(0) as Y.XmlText | undefined)?.toString() ?? "";
    const below = nested ? ` [${nested.toArray().map((n) => line(n as Y.XmlElement)).join(", ")}]` : "";
    return `${content.nodeName}:${text}${below}`;
  };
  return group.toArray().map((n) => line(n as Y.XmlElement));
}

const page = (): Spec[] => [
  { id: "h1", type: "heading", text: "Overview", level: 2 },
  { id: "p1", type: "paragraph", text: "intro" },
  { id: "h2", type: "heading", text: "Details", level: 3 },
  { id: "p2", type: "paragraph", text: "detail" },
  { id: "h3", type: "heading", text: "Next", level: 2 },
  { id: "p3", type: "paragraph", text: "later" },
];

const body = (...texts: string[]) => docOf(texts.map((text, i) => ({ id: `n${i}`, type: "paragraph", text })));

test("a section runs to the next heading of the same or a higher level", () => {
  const doc = docOf(page());
  assert.deepEqual(checkSection(doc, { heading: "Overview" }), { index: 0, end: 4 });
  assert.deepEqual(checkSection(doc, { heading: "Details" }), { index: 2, end: 4 });
  assert.deepEqual(checkSection(doc, { heading: "Next" }), { index: 4, end: 6 });
});

test("the heading is found by its text, ignoring #, case and spaces", () => {
  const doc = docOf(page());
  assert.deepEqual(checkSection(doc, { heading: "##  details " }), { index: 2, end: 4 });
  assert.deepEqual(checkSection(doc, { heading: "Missing" }), { code: "heading_not_found" });
  assert.deepEqual(checkSection(doc, { heading: "Details", level: 2 }), { code: "heading_not_found" });
});

test("several headings with the text: level or occurrence picks one", () => {
  const doc = docOf([
    { id: "a", type: "heading", text: "Notes", level: 2 },
    { id: "b", type: "paragraph", text: "one" },
    { id: "c", type: "heading", text: "Notes", level: 2 },
    { id: "d", type: "paragraph", text: "two" },
  ]);
  assert.deepEqual(checkSection(doc, { heading: "Notes" }), { code: "heading_ambiguous", count: 2 });
  assert.deepEqual(checkSection(doc, { heading: "Notes", occurrence: 2 }), { index: 2, end: 4 });
  assert.deepEqual(checkSection(doc, { heading: "Notes", occurrence: 3 }), { code: "heading_not_found" });
});

test("replacing keeps the heading and what's outside the section", () => {
  const doc = docOf(page());
  assert.equal(replaceSection(doc, { heading: "Details" }, body("new one", "new two")), null);
  assert.deepEqual(outline(doc), [
    "heading:Overview",
    "paragraph:intro",
    "heading:Details",
    "paragraph:new one",
    "paragraph:new two",
    "heading:Next",
    "paragraph:later",
  ]);
});

test("empty content empties the section, keeping the heading", () => {
  const doc = docOf(page());
  assert.equal(replaceSection(doc, { heading: "Overview" }, body("")), null);
  assert.deepEqual(outline(doc), ["heading:Overview", "heading:Next", "paragraph:later"]);
});

test("blocks nested under the heading belong to its section", () => {
  const doc = docOf([
    { id: "h", type: "heading", text: "Plan", level: 2, nested: [{ id: "x", type: "paragraph", text: "inside" }] },
    { id: "p", type: "paragraph", text: "after" },
  ]);
  assert.equal(replaceSection(doc, { heading: "Plan" }, body("fresh")), null);
  assert.deepEqual(outline(doc), ["heading:Plan", "paragraph:fresh"]);
});

test("knowlective's own blocks in the section stop the replace", () => {
  for (const [spec, type] of [
    [{ id: "t", type: "childTable" }, "childTable"],
    [{ id: "t", type: "todo", text: "do" }, "todo"],
    [{ id: "t", type: "maskedText" }, "maskedText"],
    [{ id: "t", type: "columnList" }, "columnList"],
    [{ id: "t", type: "codeBlock", text: "<b>", attrs: { preview: "below" } }, "codePreview"],
    [{ id: "t", type: "paragraph", text: "hi ", mention: true }, "mention"],
    [{ id: "t", type: "paragraph", text: "x", nested: [{ id: "u", type: "chat" }] }, "chat"],
  ] as [Spec, string][]) {
    const doc = docOf([{ id: "h", type: "heading", text: "S", level: 2 }, spec, { id: "e", type: "heading", text: "End", level: 2 }]);
    const before = outline(doc);
    assert.deepEqual(replaceSection(doc, { heading: "S" }, body("x")), { code: "custom_blocks", types: [type] }, type);
    assert.deepEqual(outline(doc), before);
  }
});

test("a toggle heading isn't replaced under", () => {
  const doc = docOf([{ id: "h", type: "heading", text: "S", level: 2, attrs: { isToggleable: true } }]);
  assert.deepEqual(checkSection(doc, { heading: "S" }), { code: "custom_blocks", types: ["toggleHeading"] });
});

test("own blocks outside the section don't matter", () => {
  const doc = docOf([
    { id: "h", type: "heading", text: "S", level: 2 },
    { id: "p", type: "paragraph", text: "plain" },
    { id: "h2", type: "heading", text: "T", level: 2 },
    { id: "t", type: "childTable" },
  ]);
  assert.equal(replaceSection(doc, { heading: "S" }, body("x")), null);
});

test("a locked block in the section, or an edit lock on the heading, stops the replace", () => {
  const locked = (id: string, lock: string) => {
    const doc = docOf(page());
    doc.getMap(BLOCK_LOCKS_FIELD).set(id, lock);
    return doc;
  };
  assert.deepEqual(checkSection(locked("p2", "delete"), { heading: "Details" }), { code: "blocks_locked" });
  assert.deepEqual(checkSection(locked("h2", "edit"), { heading: "Details" }), { code: "blocks_locked" });
  // A delete lock on the heading: it stays, so the section can change.
  assert.deepEqual(checkSection(locked("h2", "delete"), { heading: "Details" }), { index: 2, end: 4 });
  // A lock elsewhere doesn't count.
  assert.deepEqual(checkSection(locked("p3", "edit"), { heading: "Details" }), { index: 2, end: 4 });
});

test("appending adds at the end, or replaces a new page's empty paragraph", () => {
  const doc = docOf(page());
  appendBlocks(doc, body("added"));
  assert.deepEqual(outline(doc).slice(-2), ["paragraph:later", "paragraph:added"]);

  const fresh = docOf([{ id: "e", type: "paragraph", text: "" }]);
  appendBlocks(fresh, body("first", "second"));
  assert.deepEqual(outline(fresh), ["paragraph:first", "paragraph:second"]);

  const untouched = docOf(page());
  appendBlocks(untouched, body(""));
  assert.equal(outline(untouched).length, 6);
});

test("appending to a page with no body yet creates it", () => {
  const doc = new Y.Doc();
  appendBlocks(doc, body("hello"));
  assert.deepEqual(outline(doc), ["paragraph:hello"]);
});
