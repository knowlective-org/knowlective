import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { boxOutlines, insetPolygon } from "../src/components/whiteboard/outline";
import { readItem } from "../src/lib/whiteboard";

test("an outline's kind follows the border", () => {
  assert.deepEqual(boxOutlines("rect", 100, 50, "none"), []);
  assert.equal(boxOutlines("rect", 100, 50, "solid").length, 1);
  assert.equal(boxOutlines("ellipse", 100, 50, "double").length, 2);
  assert.equal(boxOutlines("diamond", 100, 50, "dashed")[0].dash, "8 6");
});

test("a polygon moves in by the same distance on every side", () => {
  const inner = insetPolygon([[0, 0], [10, 0], [10, 10], [0, 10]], 1);
  assert.deepEqual(inner, [[1, 1], [9, 1], [9, 9], [1, 9]]);
});

test("a box's styles are read from known values only", () => {
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>("t");
  const put = (fields: Record<string, unknown>) => {
    const item = new Y.Map<unknown>();
    map.set("a", item);
    for (const [k, v] of Object.entries(fields)) item.set(k, v);
    return readItem("a", item) as unknown as { border: string; borderColor: string | null; fontWeight?: number };
  };
  assert.equal(put({ type: "rect" }).border, "solid");
  assert.equal(put({ type: "sticky" }).border, "none");
  const bad = put({ type: "rect", border: "url(x)", borderColor: "red;x", fontWeight: 450 });
  assert.equal(bad.border, "solid");
  assert.equal(bad.borderColor, null);
  assert.equal(bad.fontWeight, undefined);
  const good = put({ type: "image", border: "double", borderColor: "blue", fontWeight: 900 });
  assert.deepEqual([good.border, good.borderColor, good.fontWeight], ["double", "blue", 900]);
});
