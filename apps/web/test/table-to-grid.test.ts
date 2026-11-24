import assert from "node:assert/strict";
import { test } from "node:test";
import { tableToGrid } from "../src/components/editor/table-to-grid";

const text = (t: string) => [{ type: "text", text: t, styles: {} }];
const cell = (t: string, props: Record<string, unknown> = {}) => ({ type: "tableCell", props, content: text(t) });
type Out = { children: { children: { children: { props: Record<string, string>; content: { text: string }[] }[] }[] }[] };
const texts = (block: unknown) =>
  (block as Out).children.map((row) => row.children.map((c) => c.children[0].content.map((p) => p.text).join("")));

test("a table's cells, headers, colors and widths carry over", () => {
  const result = tableToGrid(
    {
      columnWidths: [240, undefined],
      headerRows: 1,
      headerCols: 0,
      rows: [
        { cells: [cell("Name"), cell("Count")] },
        { cells: [cell("a", { textColor: "red", backgroundColor: "default", textAlignment: "right" }), cell("1")] },
      ],
    },
    "table-1",
  );
  assert.ok(result.ok);
  assert.equal(result.block.id, "table-1");
  assert.deepEqual(result.block.props, { headerRow: true, headerColumn: false, widths: "[2,1]" });
  assert.deepEqual(texts(result.block), [["Name", "Count"], ["a", "1"]]);
  const props = (result.block as unknown as Out).children[1].children[0].children[0].props;
  assert.deepEqual(props, { textColor: "red", textAlignment: "right" });
});

test("equal widths are left unset, and no header row stays none", () => {
  const result = tableToGrid({ columnWidths: [undefined, undefined], rows: [{ cells: [cell("x"), cell("y")] }] });
  assert.ok(result.ok);
  assert.deepEqual(result.block.props, { headerRow: false, headerColumn: false, widths: "" });
});

test("merged cells are split, the text staying in the first", () => {
  const result = tableToGrid({
    rows: [
      { cells: [cell("wide", { colspan: 2 }), cell("tall", { rowspan: 2 })] },
      { cells: [cell("b"), cell("c")] },
      { cells: [cell("d")] },
    ],
  });
  assert.ok(result.ok);
  assert.deepEqual(texts(result.block), [
    ["wide", "", "tall"],
    ["b", "c", ""],
    ["d", "", ""],
  ]);
});

test("too many rows or columns are refused", () => {
  const wide = tableToGrid({ rows: [{ cells: Array.from({ length: 21 }, () => cell("x")) }] });
  assert.deepEqual(wide, { ok: false, reason: "columns", max: 20 });
  const long = tableToGrid({ rows: Array.from({ length: 201 }, () => ({ cells: [cell("x")] })) });
  assert.deepEqual(long, { ok: false, reason: "rows", max: 200 });
});

test("cells given as plain inline content or text", () => {
  const result = tableToGrid({ rows: [{ cells: [text("p"), "s", ""] }] });
  assert.ok(result.ok);
  assert.deepEqual(texts(result.block), [["p", "s", ""]]);
});
