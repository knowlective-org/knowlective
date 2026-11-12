import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { hasChildViewBlock } from "../src/lib/child-view-blocks";

// Whether a page shows its child pages with their columns
// (lib/child-view-blocks.ts): only then do the child pages show their values.

// A document with these blocks (BlockNote's shape: a blockContainer holding
// the block's content), the last one inside a column.
function state(types: string[], nested?: string): Uint8Array {
  const doc = new Y.Doc();
  const group = new Y.XmlElement("blockGroup");
  doc.getXmlFragment("blocknote").insert(0, [group]);
  const container = (type: string) => {
    const c = new Y.XmlElement("blockContainer");
    c.insert(0, [new Y.XmlElement(type)]);
    return c;
  };
  group.insert(0, types.map(container));
  if (nested) {
    const columns = new Y.XmlElement("columnList");
    const column = new Y.XmlElement("column");
    columns.insert(0, [column]);
    column.insert(0, [container(nested)]);
    group.insert(group.length, [columns]);
  }
  return Y.encodeStateAsUpdate(doc);
}

test("a table, board or calendar, also inside columns", () => {
  assert.equal(hasChildViewBlock(state(["paragraph", "childCalendar"])), true);
  assert.equal(hasChildViewBlock(state(["childTable"])), true);
  assert.equal(hasChildViewBlock(state(["paragraph"], "childBoard")), true);
});

test("none: only text, or the plain list of child pages", () => {
  assert.equal(hasChildViewBlock(state(["paragraph", "childPages"])), false);
  assert.equal(hasChildViewBlock(state([])), false);
});
