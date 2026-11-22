import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CHECKED,
  convertTexts,
  formatNumber,
  isValidText,
  moveColumnRule,
  normalizeCheckbox,
  normalizeDate,
  normalizeNumber,
  parseColumns,
  selectedOptions,
  serializeColumns,
  shiftColumns,
} from "../src/components/editor/grid-types";

// The input rules of an extended table's columns (components/editor/grid-types.ts).
//   pnpm --filter web test:unit

describe("extended table column types", () => {
  test("read back checked: unknown types, bad options and colors dropped, one per column", () => {
    const raw = JSON.stringify([
      { type: "number" },
      { type: "nope" },
      { type: "select", multiple: true, options: [{ name: " 進行中 ", color: "#dbeddb" }, { name: "進行中" }, { name: 5 }, { name: "完了", color: "red" }] },
      "x",
    ]);
    const columns = parseColumns(raw, 5);
    assert.equal(columns.length, 5);
    assert.deepEqual(columns[0], { type: "number", grouping: true, decimals: null });
    assert.equal(columns[1], null);
    assert.deepEqual(columns[2], {
      type: "select",
      multiple: true,
      options: [
        { name: "進行中", color: "#dbeddb" },
        { name: "完了", color: "#fadec9" },
      ],
    });
    assert.equal(columns[3], null);
    assert.equal(columns[4], null);
    assert.deepEqual(parseColumns("not json", 2), [null, null]);
    assert.equal(serializeColumns([null, null]), "");
  });

  test("columns inserted, deleted and moved keep their rules", () => {
    const n = { type: "number" as const, grouping: true, decimals: null };
    const raw = serializeColumns([n, null, { type: "date" }]);
    assert.deepEqual(parseColumns(shiftColumns(raw, 3, 1, 1), 4), [n, null, null, { type: "date" }]);
    assert.deepEqual(parseColumns(shiftColumns(raw, 3, 0, -1), 2), [null, { type: "date" }]);
    assert.deepEqual(parseColumns(moveColumnRule(raw, 3, 2, 0), 3), [{ type: "date" }, n, null]);
  });

  test("numbers: any width, separators; the stored form as typed", () => {
    assert.equal(normalizeNumber("12,000"), "12000");
    assert.equal(normalizeNumber("１２３"), "123");
    assert.equal(normalizeNumber(" -3.50 "), "-3.50");
    assert.equal(normalizeNumber(".5"), "0.5");
    assert.equal(normalizeNumber("+7"), "7");
    assert.equal(normalizeNumber("007"), "7");
    assert.equal(normalizeNumber(""), "");
    for (const bad of ["12a", "1.2.3", "--1", "¥100", "1e5", "Infinity"]) assert.equal(normalizeNumber(bad), null, bad);
    const n = { type: "number" as const, grouping: true, decimals: null };
    assert.ok(isValidText("1234.5", n));
    assert.ok(!isValidText("1,234", n));
    // Shown with separators, its decimals as typed or fixed; stored as typed.
    assert.equal(formatNumber("1234567.50", n, "en"), "1,234,567.50");
    assert.equal(formatNumber("1234567.5", { ...n, grouping: false, decimals: 0 }, "en"), "1234568");
    assert.equal(formatNumber("2", { ...n, decimals: 2 }, "en"), "2.00");
    assert.equal(formatNumber("たくさん", n, "en"), "たくさん");
    assert.deepEqual(parseColumns(JSON.stringify([{ type: "number", grouping: false, decimals: 9 }]), 1)[0], { type: "number", grouping: false, decimals: null });
  });

  test("dates: written several ways, real dates only", () => {
    assert.equal(normalizeDate("2026/12/1"), "2026-12-01");
    assert.equal(normalizeDate("2026年12月1日"), "2026-12-01");
    assert.equal(normalizeDate("２０２６－１２－０１"), "2026-12-01");
    assert.equal(normalizeDate("2026-02-30"), null);
    assert.equal(normalizeDate("来週"), null);
    assert.equal(normalizeDate(""), "");
  });

  test("checkboxes: common words for on and off", () => {
    for (const on of ["✓", "TRUE", "yes", "済", "x", "1"]) assert.equal(normalizeCheckbox(on), CHECKED, on);
    for (const off of ["", "false", "no", "0", "☐"]) assert.equal(normalizeCheckbox(off), "", off);
    assert.equal(normalizeCheckbox("たぶん"), null);
  });

  test("options: a column's options made from what its cells say; several only where allowed", () => {
    const single = convertTexts(["未着手", "進行中", "", "未着手, 完了"], { type: "select", multiple: false, options: [] });
    assert.deepEqual(
      single.column.type === "select" && single.column.options.map((o) => o.name),
      ["未着手", "進行中", "完了"],
    );
    assert.deepEqual(single.values, ["未着手", "進行中", "", null]);
    const multiple = convertTexts(["完了、未着手"], { type: "select", multiple: true, options: [] });
    // In the column's order (as first named).
    assert.deepEqual(multiple.values, ["完了\n未着手"]);
    const column = { type: "select" as const, multiple: true, options: [{ name: "A", color: "#e3e2e0" }, { name: "B", color: "#e3e2e0" }] };
    assert.deepEqual(selectedOptions("B\nA\nZ", column), { names: ["A", "B"], unknown: ["Z"] });
    assert.ok(isValidText("A\nB", column));
    assert.ok(!isValidText("B\nA", column));
    assert.ok(!isValidText("Z", column));
  });

  test("other conversions: what fails is null, empty stays empty", () => {
    assert.deepEqual(convertTexts(["12,000", "x", ""], { type: "number", grouping: true, decimals: null }).values, ["12000", null, ""]);
    assert.deepEqual(convertTexts(["2026/1/2", "そのうち"], { type: "date" }).values, ["2026-01-02", null]);
    // People and masked values are the editor's: any text is left to it.
    assert.deepEqual(convertTexts(["山田", ""], { type: "user" }).values, [null, ""]);
  });
});
