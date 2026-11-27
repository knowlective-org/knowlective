import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Y from "yjs";
import { readItems, whiteboardMap } from "../src/lib/whiteboard";
import { focusFromSearch, focusFromSelection, focusSearch, focusedItems, groupToJoin, parseFocus, serializeFocus } from "../src/lib/whiteboard-focus";

// A part of a whiteboard (lib/whiteboard-focus.ts): what a whiteboard block
// shows, and what a selection exports.
//   pnpm --filter web test:unit

function items(fields: Record<string, Record<string, unknown>>) {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [id, f] of Object.entries(fields)) {
      const item = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(f)) item.set(key, value);
      whiteboardMap(doc).set(id, item);
    }
  });
  return readItems(doc);
}

const box = (x: number, group?: string) => ({ type: "rect", x, y: 0, w: 100, h: 60, text: "", color: "white", ...(group ? { group } : {}) });

const board = () =>
  items({
    a: box(0, "g1"),
    b: box(200, "g1"),
    c: box(400),
    d: box(600),
    ab: { type: "connector", from: "a", to: "b" },
    cd: { type: "connector", from: "c", to: "d" },
    ac: { type: "connector", from: "a", to: "c" },
  });
const ids = (list: { id: string }[]) => list.map((i) => i.id).sort();

describe("parseFocus", () => {
  test("empty or malformed is the whole board", () => {
    for (const raw of ["", "x", "null", "[]", "{}", '{"items":[]}', 5, null, '{"items":"a"}']) assert.equal(parseFocus(raw), null);
  });
  test("keeps only ids that look like ids, once each", () => {
    assert.deepEqual(parseFocus('{"items":["a","a","<x>",3,""],"groups":["g1"]}'), { items: ["a"], groups: ["g1"] });
  });
  test("round-trips", () => {
    const focus = { items: ["c"], groups: ["g1"] };
    assert.deepEqual(parseFocus(serializeFocus(focus)), focus);
    assert.equal(serializeFocus(null), "");
  });
});

describe("focusFromSelection", () => {
  test("a whole group is kept as the group", () => {
    assert.deepEqual(focusFromSelection(board(), ["a", "b", "c"]), { items: ["c"], groups: ["g1"] });
  });
  test("part of a group is kept item by item", () => {
    assert.deepEqual(focusFromSelection(board(), ["a"]), { items: ["a"], groups: [] });
  });
  test("connectors alone make no part", () => {
    assert.equal(focusFromSelection(board(), ["cd"]), null);
    assert.equal(focusFromSelection(board(), []), null);
  });
});

describe("focusedItems", () => {
  test("null is everything", () => {
    assert.equal(focusedItems(board(), null).length, 7);
  });
  test("shows the connectors between the boxes shown", () => {
    assert.deepEqual(ids(focusedItems(board(), { items: ["c", "d"], groups: [] })), ["c", "cd", "d"]);
    assert.deepEqual(ids(focusedItems(board(), { items: ["c"], groups: ["g1"] })), ["a", "ab", "ac", "b", "c"]);
  });
  test("follows the group: items put in it later are shown", () => {
    const later = items({ a: box(0, "g1"), e: box(800, "g1"), c: box(400) });
    assert.deepEqual(ids(focusedItems(later, { items: [], groups: ["g1"] })), ["a", "e"]);
  });
  test("a connector named alone isn't shown without both its boxes", () => {
    assert.deepEqual(ids(focusedItems(board(), { items: ["ac", "a"], groups: [] })), ["a"]);
  });
  test("ids no longer on the board show nothing", () => {
    assert.deepEqual(focusedItems(board(), { items: ["gone"], groups: ["nogroup"] }), []);
  });
});

describe("groupToJoin", () => {
  test("a whole group selected keeps its id", () => {
    assert.equal(groupToJoin(board(), ["c", "a", "b"]), "g1");
  });
  test("part of a group, or no group: a new one", () => {
    assert.equal(groupToJoin(board(), ["a", "c"]), null);
    assert.equal(groupToJoin(board(), ["c", "d"]), null);
  });
});

describe("links to items", () => {
  test("the part goes in the address and back", () => {
    const focus = { items: ["c", "d"], groups: ["g1"] };
    assert.equal(focusSearch(focus), "items=c%2Cd&groups=g1");
    assert.deepEqual(focusFromSearch(new URLSearchParams(focusSearch(focus))), focus);
    assert.equal(focusSearch({ items: [], groups: ["g1"] }), "groups=g1");
  });
  test("an address without items, or with anything else, names none", () => {
    assert.equal(focusFromSearch(new URLSearchParams("")), null);
    assert.equal(focusFromSearch(new URLSearchParams("slide=x")), null);
    assert.deepEqual(focusFromSearch(new URLSearchParams("items=a,<b>,,a")), { items: ["a"], groups: [] });
    assert.equal(focusFromSearch(new URLSearchParams("items=%3Cscript%3E")), null);
  });
});
