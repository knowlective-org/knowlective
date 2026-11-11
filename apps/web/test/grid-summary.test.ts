import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cellNumber,
  matchesCriteria,
  parseSummary,
  roundSummary,
  serializeSummary,
  shiftSummary,
  summaryValue,
} from "../src/components/editor/grid-summary";

// The extended table's summary row (components/editor/grid-summary.ts).
describe("grid table summary", () => {
  const rows = [
    ["りんご", "120", "完了"],
    ["みかん", "1,000", "進行中"],
    ["ぶどう", "", "完了"],
    ["もも", "¥80", "保留"],
    ["", "abc", ""],
  ];

  test("numbers in cells: widths, separators, currency and percent", () => {
    assert.equal(cellNumber("1,234"), 1234);
    assert.equal(cellNumber("１２３"), 123);
    assert.equal(cellNumber("¥1,500"), 1500);
    assert.equal(cellNumber("-$3.5"), -3.5);
    assert.equal(cellNumber("200円"), 200);
    assert.equal(cellNumber("50%"), 0.5);
    assert.equal(cellNumber("1e3"), 1000);
    assert.equal(cellNumber(""), null);
    assert.equal(cellNumber("abc"), null);
    assert.equal(cellNumber("12abc"), null);
    assert.equal(cellNumber("1.2.3"), null);
  });

  test("the functions", () => {
    assert.equal(summaryValue({ fn: "sum" }, rows, 1), 1200);
    assert.equal(summaryValue({ fn: "average" }, rows, 1), 400);
    assert.equal(summaryValue({ fn: "count" }, rows, 1), 3);
    assert.equal(summaryValue({ fn: "counta" }, rows, 1), 4);
    assert.equal(summaryValue({ fn: "min" }, rows, 1), 80);
    assert.equal(summaryValue({ fn: "max" }, rows, 1), 1000);
    assert.equal(summaryValue({ fn: "average" }, rows, 0), null);
    assert.equal(summaryValue(null, rows, 1), null);
  });

  test("COUNTIF and SUMIF, with conditions as in a spreadsheet", () => {
    assert.equal(summaryValue({ fn: "countif", criteria: "完了" }, rows, 2), 2);
    assert.equal(summaryValue({ fn: "countif", criteria: "<>完了" }, rows, 2), 3);
    assert.equal(summaryValue({ fn: "countif", criteria: "" }, rows, 2), 1);
    assert.equal(summaryValue({ fn: "countif", criteria: "<>" }, rows, 2), 4);
    assert.equal(summaryValue({ fn: "countif", criteria: ">=120" }, rows, 1), 2);
    assert.equal(summaryValue({ fn: "countif", criteria: "*か*" }, rows, 0), 1);
    // The amounts of the rows that are done (column 2), added up in column 1.
    assert.equal(summaryValue({ fn: "sumif", criteria: "完了", range: 2 }, rows, 1), 120);
    assert.equal(summaryValue({ fn: "sumif", criteria: ">100" }, rows, 1), 1120);
  });

  test("conditions", () => {
    assert.equal(matchesCriteria("ABC", "abc"), true);
    assert.equal(matchesCriteria("10", "=10.0"), true);
    assert.equal(matchesCriteria("9", ">10"), false);
    assert.equal(matchesCriteria("abc", ">10"), false);
    assert.equal(matchesCriteria("", "<10"), false);
    assert.equal(matchesCriteria("a.b", "a.b"), true);
    assert.equal(matchesCriteria("axb", "a.b"), false);
    assert.equal(matchesCriteria("abc", "a?c"), true);
    assert.equal(matchesCriteria("b", ">a"), true);
  });

  test("specs from the shared document are checked", () => {
    assert.equal(parseSummary("", 3), null);
    assert.equal(parseSummary("not json", 3), null);
    assert.equal(parseSummary("{}", 3), null);
    const specs = parseSummary(
      JSON.stringify([{ fn: "sum" }, { fn: "evil" }, { fn: "sumif", criteria: 5, range: 99 }, { fn: "count" }]),
      3,
    )!;
    assert.deepEqual(specs, [{ fn: "sum" }, null, { fn: "sumif", criteria: "", range: undefined }]);
    assert.deepEqual(parseSummary("[]", 2), [null, null]);
    assert.equal(parseSummary(JSON.stringify([{ fn: "countif", criteria: "x".repeat(500) }]), 1)![0]!.criteria!.length, 100);
  });

  test("specs follow their columns when columns are inserted or deleted", () => {
    const value = serializeSummary([{ fn: "sum" }, { fn: "sumif", criteria: "a", range: 2 }, { fn: "count" }]);
    assert.deepEqual(parseSummary(shiftSummary(value, 3, 1, 1), 4), [
      { fn: "sum" },
      null,
      { fn: "sumif", criteria: "a", range: 3 },
      { fn: "count" },
    ]);
    // Deleting the condition's column: SUMIF tests its own column.
    assert.deepEqual(parseSummary(shiftSummary(value, 3, 2, -1), 2), [{ fn: "sum" }, { fn: "sumif", criteria: "a", range: undefined }]);
    assert.deepEqual(parseSummary(shiftSummary(value, 3, 0, -1), 2), [{ fn: "sumif", criteria: "a", range: 1 }, { fn: "count" }]);
    assert.equal(shiftSummary("", 3, 0, 1), "");
  });

  test("rounding", () => {
    assert.equal(roundSummary(0.1 + 0.2), 0.3);
  });
});
