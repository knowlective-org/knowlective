import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Y from "yjs";
import { readItems, whiteboardMap } from "../src/lib/whiteboard";
import { applyWhiteboardOps, imageFileIds, planWhiteboardChange } from "../src/lib/whiteboard-ops";

// Changes to a whiteboard through the public API (lib/whiteboard-ops.ts):
// checked against the board, then made as plain operations.

function board(items: Record<string, Record<string, unknown>> = {}): Y.Doc {
  const doc = new Y.Doc();
  const map = whiteboardMap(doc);
  for (const [id, fields] of Object.entries(items)) {
    const item = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) item.set(k, v);
    map.set(id, item);
  }
  return doc;
}

let n = 0;
const newId = () => `new${++n}`;

function change(doc: Y.Doc, input: unknown) {
  const plan = planWhiteboardChange(doc, input, newId);
  if ("error" in plan) return plan;
  applyWhiteboardOps(doc, plan.ops);
  return plan;
}

describe("whiteboard changes from the API", () => {
  test("adds boxes and a connector between them, in front of what's there", () => {
    const doc = board({ old: { type: "rect", x: 0, y: 0, w: 100, h: 50, z: 7 } });
    const plan = change(doc, {
      add: [
        { id: "a", type: "sticky", x: 10, y: 20, w: 100, h: 100, text: "メモ", color: "yellow" },
        { id: "b", type: "ellipse", x: 300, y: 20, w: 100, h: 70 },
        { type: "connector", from: "a", to: "b", route: "elbow", arrows: "end" },
      ],
    });
    assert.ok(!("error" in plan));
    assert.deepEqual(plan.added.slice(0, 2), ["a", "b"]);
    const items = readItems(doc);
    assert.equal(items.length, 4);
    const sticky = items.find((i) => i.id === "a")!;
    assert.equal(sticky.text, "メモ");
    assert.ok(sticky.z > 7);
    assert.ok(items.some((i) => i.type === "connector" && i.from === "a" && i.to === "b"));
  });

  test("updates fields, and changes a shape into another shape", () => {
    const doc = board({ a: { type: "rect", x: 0, y: 0, w: 100, h: 50, text: "前" } });
    const plan = change(doc, { update: [{ id: "a", text: "後", type: "diamond", color: "blue" }] });
    assert.ok(!("error" in plan));
    const [item] = readItems(doc);
    assert.equal(item.type, "diamond");
    assert.equal(item.text, "後");
    assert.equal(item.color, "blue");
  });

  test("removing a box takes its connectors with it", () => {
    const doc = board({
      a: { type: "rect", x: 0, y: 0, w: 100, h: 50 },
      b: { type: "rect", x: 200, y: 0, w: 100, h: 50 },
      c: { type: "connector", from: "a", to: "b" },
    });
    const plan = change(doc, { remove: ["a"] });
    assert.ok(!("error" in plan));
    assert.deepEqual(plan.ops.remove.sort(), ["a", "c"]);
    assert.deepEqual([...whiteboardMap(doc).keys()], ["b"]);
  });

  test("refuses what the board can't show, and leaves it unchanged", () => {
    const doc = board({ a: { type: "rect", x: 0, y: 0, w: 100, h: 50 }, l: { type: "line", x1: 0, y1: 0, x2: 1, y2: 1 } });
    const refused = (input: unknown) => {
      const plan = planWhiteboardChange(doc, input, newId);
      assert.ok("error" in plan, JSON.stringify(input));
    };
    refused({});
    refused({ add: "x" });
    refused({ add: [{ type: "star" }] });
    refused({ add: [{ type: "rect", color: "red" }] });
    refused({ add: [{ type: "rect", w: 1e9 }] });
    refused({ add: [{ type: "rect", text: "x".repeat(6000) }] });
    refused({ add: [{ type: "rect", from: "a" }] });
    refused({ add: [{ type: "rect", src: "/api/files/x" }] });
    refused({ add: [{ type: "image", src: "https://evil.example/x.png" }] });
    refused({ add: [{ type: "rect", link: "javascript:alert(1)" }] });
    refused({ add: [{ type: "connector", from: "a", to: "nowhere" }] });
    refused({ add: [{ type: "connector", from: "a", to: "l" }] });
    refused({ add: [{ type: "connector", from: "a", to: "a" }] });
    refused({ add: [{ id: "a", type: "rect" }] });
    refused({ add: [{ id: "bad id", type: "rect" }] });
    refused({ add: [{ type: "rect", x: { $gt: 1 } }] });
    refused({ update: [{ id: "missing", text: "x" }] });
    refused({ update: [{ id: "l", type: "rect" }] });
    refused({ update: [{ id: "a", type: "connector" }] });
    refused({ remove: ["missing"] });
    assert.equal(whiteboardMap(doc).size, 2);
  });

  test("images: an attachment's URL, whose file the caller then checks", () => {
    const doc = board();
    const plan = planWhiteboardChange(doc, { add: [{ type: "image", x: 0, y: 0, w: 200, h: 100, src: "/api/files/abc_123" }] }, newId);
    assert.ok(!("error" in plan));
    assert.deepEqual(imageFileIds(plan.ops), ["abc_123"]);
  });
});
