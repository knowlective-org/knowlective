import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type DocBlock, type ReadTable, columnNames, findPageTables, selectTableColumns } from "../src/lib/page-tables";

// The tables in a page's body, for the API and MCP (lib/page-tables.ts).
//   pnpm --filter web test:unit

const text = (t: string) => [{ type: "text", text: t, styles: {} }];
const para = (t: string): DocBlock => ({ type: "paragraph", content: text(t) });
const cell = (...children: DocBlock[]): DocBlock => ({ type: "gridCell", children });
const row = (...cells: DocBlock[]): DocBlock => ({ type: "gridRow", children: cells });
const read = (blocks: DocBlock[], people: Record<string, string> = {}) => findPageTables(blocks, "page", people) as ReadTable[];

describe("tables in a page's body", () => {
  test("column names: empty ones numbered, shared ones told apart", () => {
    assert.deepEqual(columnNames(["名前", "", "名前", " a  b "]), ["名前", "Column 2", "名前 (2)", "a b"]);
  });

  test("a table: its header row names the columns; a merged cell takes its first place", () => {
    const [table] = read([
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          headerRows: 1,
          rows: [
            { cells: [{ type: "tableCell", content: text("名前"), props: {} }, { type: "tableCell", content: text("値"), props: {} }, { type: "tableCell", content: text("備考"), props: {} }] },
            { cells: [{ type: "tableCell", content: text("A"), props: { colspan: 2 } }, { type: "tableCell", content: text("x"), props: {} }] },
          ],
        },
      },
    ]);
    assert.deepEqual(table.columns.map((c) => c.name), ["名前", "値", "備考"]);
    assert.deepEqual(table.rows, [{ row: 1, values: { 名前: "A", 値: null, 備考: "x" } }]);
  });

  test("an extended table: each column's value by its type", () => {
    const mention = { type: "mention", props: { userId: "u1" } };
    const columns = JSON.stringify([
      { type: "number" },
      { type: "date" },
      { type: "select", multiple: true, options: [{ name: "赤", color: "#e3e2e0" }, { name: "青", color: "#e3e2e0" }] },
      { type: "checkbox" },
      { type: "user" },
      null,
    ]);
    const [table] = read(
      [
        {
          id: "g1",
          type: "gridTable",
          props: { headerRow: true, columns },
          children: [
            row(cell(para("数")), cell(para("日")), cell(para("色")), cell(para("済")), cell(para("人")), cell(para("文"))),
            row(cell(para("1234.5")), cell(para("2026-12-01")), cell(para("赤\n青")), cell(para("✓")), cell({ type: "paragraph", content: [mention] }), cell(para("メモ"), para("続き"))),
            row(cell(para("12345678901234567890")), cell(), cell(), cell(), cell(), cell()),
          ],
        },
      ],
      { u1: "佐藤" },
    );
    assert.equal(table.kind, "extendedTable");
    assert.deepEqual(table.rows[0].values, { 数: 1234.5, 日: "2026-12-01", 色: ["赤", "青"], 済: true, 人: { id: "u1", name: "佐藤" }, 文: "メモ 続き" });
    // A number that wouldn't keep its digits stays as text; empty cells are null (a checkbox false).
    assert.deepEqual(table.rows[1].values, { 数: "12345678901234567890", 日: null, 色: null, 済: false, 人: null, 文: null });
  });

  test("masked values are never returned: a masked column, or a masked block in a text cell", () => {
    const sealed = "v1.600000.c2FsdA.aXY.Y2lwaGVy";
    const [table] = read([
      {
        id: "g2",
        type: "gridTable",
        props: { headerRow: true, columns: JSON.stringify([{ type: "masked" }, null]) },
        children: [
          row(cell(para("鍵")), cell(para("文"))),
          row(cell(para(sealed)), cell({ type: "maskedText", props: { sealed } }, para("見える"))),
          row(cell(), cell()),
        ],
      },
    ]);
    assert.deepEqual(table.rows[0].values, { 鍵: { masked: true }, 文: "見える" });
    assert.deepEqual(table.rows[1].values, { 鍵: null, 文: null });
    assert.ok(!JSON.stringify(table).includes(sealed));
  });

  test("found anywhere, with the heading above; a child page table names its source", () => {
    const found = findPageTables(
      [
        { type: "heading", content: text("売上") },
        { id: "c1", type: "childTable", props: { title: "案件", source: "" } },
        { id: "c2", type: "childTable", props: { source: "other-page" } },
        { id: "c3", type: "childTable", props: { source: "unset" } },
        // A source that isn't a page id (from the shared document) is ignored.
        { id: "c4", type: "childTable", props: { source: "../etc" } },
        {
          id: "g3",
          type: "gridTable",
          props: {},
          children: [row(cell({ id: "inner", type: "table", content: { type: "tableContent", rows: [{ cells: [text("x")] }] } }))],
        },
      ],
      "page",
      {},
    );
    assert.deepEqual(found.map((t) => t.id), ["c1", "c2", "c3", "c4", "g3", "inner"]);
    assert.deepEqual(found.slice(0, 4).map((t) => ("source" in t ? t.source : "")), ["page", "other-page", null, "page"]);
    assert.equal(found[0].heading, "売上");
    assert.equal(found[0].title, "案件");
  });

  test("the whole table, or only the named columns; an unknown name is told", () => {
    const table = {
      columns: [{ name: "a", type: "text" }, { name: "b", type: "text" }],
      rows: [{ row: 1, values: { a: "1", b: "2" } }],
    };
    assert.equal(selectTableColumns(table), table);
    const one = selectTableColumns(table, ["b"]);
    assert.ok(!("unknown" in one));
    assert.deepEqual(one.columns.map((c) => c.name), ["b"]);
    assert.deepEqual(one.rows[0].values, { b: "2" });
    assert.deepEqual(selectTableColumns(table, ["b", "c"]), { unknown: ["c"] });
  });
});
