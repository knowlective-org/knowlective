import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { enterInList, parseRichText, toggleList } from "../src/components/whiteboard/rich-text";
import { fractionAlong, pointAlong } from "../src/components/whiteboard/geometry";

// Lists in whiteboard text (components/whiteboard/rich-text.ts), and where a
// connector's texts sit along it.
//   pnpm --filter web test:unit

describe("whiteboard text lists", () => {
  test("lines starting with a bullet or a number are shown as lists", () => {
    assert.deepEqual(parseRichText("Title\n- one\n* two\n・三\n\n3. three\n4) four\nend"), [
      { kind: "text", text: "Title" },
      { kind: "bullet", items: ["one", "two", "三"] },
      { kind: "text", text: "" },
      { kind: "number", start: 3, items: ["three", "four"] },
      { kind: "text", text: "end" },
    ]);
    // Not a list: no space after the dash, or a number that's part of a sentence.
    assert.deepEqual(parseRichText("-1 degree\n2026.11 plan"), [{ kind: "text", text: "-1 degree\n2026.11 plan" }]);
  });

  test("Enter continues a list, and ends it on an empty item", () => {
    assert.deepEqual(enterInList("- milk"), { continue: "- " });
    assert.deepEqual(enterInList("  * eggs"), { continue: "  * " });
    assert.deepEqual(enterInList("・パン"), { continue: "・" });
    assert.deepEqual(enterInList("9. nine"), { continue: "10. " });
    assert.deepEqual(enterInList("- "), { end: true });
    assert.deepEqual(enterInList("2. "), { end: true });
    assert.equal(enterInList("just text"), null);
  });

  test("a whole text made a list, numbered from 1, and back", () => {
    assert.equal(toggleList("one\n\ntwo", "bullet"), "- one\n\n- two");
    assert.equal(toggleList("- one\n- two", "number"), "1. one\n2. two");
    assert.equal(toggleList("1. one\n2. two", "number"), "one\ntwo");
    assert.equal(toggleList("- one\nplain", "bullet"), "- one\n- plain");
  });
});

describe("text along a connector", () => {
  const run = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  test("a point a distance along the run, from either end", () => {
    assert.deepEqual(pointAlong(run, 30), { x: 30, y: 0 });
    assert.deepEqual(pointAlong(run, 150), { x: 100, y: 50 });
    assert.deepEqual(pointAlong([...run].reverse(), 30), { x: 100, y: 70 });
    assert.deepEqual(pointAlong(run, 999), { x: 100, y: 100 });
  });

  test("how far along the run a clicked point is", () => {
    assert.equal(fractionAlong(run, { x: 10, y: 4 }), 0.05);
    assert.equal(fractionAlong(run, { x: 104, y: 50 }), 0.75);
    assert.equal(fractionAlong(run, { x: 200, y: 200 }), 1);
  });
});
