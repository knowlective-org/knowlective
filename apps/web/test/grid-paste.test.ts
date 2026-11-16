import assert from "node:assert/strict";
import { test } from "node:test";
import { tableFromTsv, trimTable } from "../src/components/editor/grid-paste";

// Table data pasted into the extended table.
//   pnpm --filter web test:unit

test("tab-separated lines are rows of cells", () => {
  assert.deepEqual(tableFromTsv("a\tb\nc\td\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(tableFromTsv("a\tb\r\nc\r\n"), [
    ["a", "b"],
    ["c", ""],
  ]);
});

test("text without a tab isn't a table", () => {
  assert.equal(tableFromTsv("one line"), null);
  assert.equal(tableFromTsv("two\nlines"), null);
});

test("quoted cells keep their tabs, line breaks and quotes", () => {
  assert.deepEqual(tableFromTsv('"a\tb"\t"line1\nline2"\n"say ""hi"""\tx'), [
    ["a\tb", "line1\nline2"],
    ['say "hi"', "x"],
  ]);
});

test("empty rows and columns at the end are left out", () => {
  assert.deepEqual(trimTable([["a", "", ""], ["", "", ""]]), [["a"]]);
  assert.equal(trimTable([["", ""]]), null);
});
