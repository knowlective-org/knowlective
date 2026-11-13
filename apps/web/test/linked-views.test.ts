import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { hasChildViewBlock, linkedViewSources } from "../src/lib/child-view-blocks";
import { LINKED_UNSET, isLinkedView, linkedSource } from "../src/lib/linked-views";
import { exportLinkedSources } from "../src/components/editor/markdown-export";

// Linked views: a child page table, board or calendar showing another page's
// child pages (lib/linked-views.ts).
//   pnpm --filter web test:unit

test("a block's source: its own page, not chosen yet, or a page id", () => {
  assert.equal(linkedSource(""), null);
  assert.equal(linkedSource(LINKED_UNSET), null);
  assert.equal(linkedSource("cmabc123xyz"), "cmabc123xyz");
  // From the shared document: anything that isn't an id is ignored.
  assert.equal(linkedSource("../admin"), null);
  assert.equal(linkedSource("a b"), null);
  assert.equal(linkedSource("x".repeat(65)), null);
  assert.equal(linkedSource(42), null);
  assert.equal(linkedSource(undefined), null);

  assert.equal(isLinkedView(""), false);
  assert.equal(isLinkedView(undefined), false);
  assert.equal(isLinkedView(LINKED_UNSET), true);
  assert.equal(isLinkedView("cmabc123xyz"), true);
});

// A document's state with these blocks (BlockNote's nesting: blockGroup >
// blockContainer > the block), one inside a column list.
function documentWith(blocks: { type: string; source?: string }[]): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("blocknote");
  const group = new Y.XmlElement("blockGroup");
  fragment.insert(0, [group]);
  const containers = blocks.map(({ type, source }) => {
    const container = new Y.XmlElement("blockContainer");
    const block = new Y.XmlElement(type);
    if (source !== undefined) block.setAttribute("source", source);
    container.insert(0, [block]);
    return container;
  });
  const columns = new Y.XmlElement("columnList");
  const column = new Y.XmlElement("column");
  columns.insert(0, [column]);
  group.insert(0, [columns]);
  // The first block goes in the column, the others at the top level.
  if (containers[0]) column.insert(0, [containers[0]]);
  group.insert(1, containers.slice(1));
  return Y.encodeStateAsUpdate(doc);
}

function sourcesOf(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return linkedViewSources(doc).sort();
}

test("only views of the page's own child pages count for its child pages' properties", () => {
  // Blocks from before `source` existed have no attribute: their own page's.
  assert.equal(hasChildViewBlock(documentWith([{ type: "childTable" }])), true);
  assert.equal(hasChildViewBlock(documentWith([{ type: "childBoard", source: "" }])), true);
  assert.equal(hasChildViewBlock(documentWith([{ type: "childCalendar", source: "cmother1" }])), false);
  assert.equal(hasChildViewBlock(documentWith([{ type: "childTable", source: LINKED_UNSET }])), false);
  assert.equal(hasChildViewBlock(documentWith([{ type: "childPages" }])), false);
  assert.equal(
    hasChildViewBlock(documentWith([{ type: "childTable", source: "cmother1" }, { type: "childBoard" }])),
    true,
  );
});

test("the pages a document's linked views show, each once, inside columns too", () => {
  const state = documentWith([
    { type: "childTable", source: "cmother1" },
    { type: "childBoard", source: "cmother2" },
    { type: "childCalendar", source: "cmother1" },
    { type: "childTable", source: LINKED_UNSET },
    { type: "childTable" },
    { type: "paragraph", source: "cmother3" },
  ]);
  assert.deepEqual(sourcesOf(state), ["cmother1", "cmother2"]);
});

test("the export loads the linked views' pages, not the page itself", () => {
  const blocks = [
    { type: "childTable", props: { source: "cmother1" } },
    { type: "paragraph", props: {}, children: [{ type: "childBoard", props: { source: "cmself" } }] },
    { type: "column", children: [{ type: "childCalendar", props: { source: "cmother2" } }] },
    { type: "childTable", props: { source: LINKED_UNSET } },
  ];
  assert.deepEqual(exportLinkedSources(blocks, "cmself").sort(), ["cmother1", "cmother2"]);
});
