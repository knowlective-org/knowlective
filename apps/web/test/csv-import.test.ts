import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CSV_COLUMNS, MAX_CSV_ROWS, csvToTable, parseCsv } from "../src/components/editor/csv-import";

// CSV files expanded into a table block (components/editor/csv-import.ts).

test("quotes hold commas, line breaks and doubled quotes", () => {
  assert.deepEqual(parseCsv('名前,メモ\r\n"山田, 太郎","1行目\n2行目"\r\n"say ""hi""",x\r\n'), [
    ["名前", "メモ"],
    ["山田, 太郎", "1行目\n2行目"],
    ['say "hi"', "x"],
  ]);
});

test("a BOM, blank lines and empty fields", () => {
  assert.deepEqual(parseCsv("﻿a,b,c\n\n1,,3\n,\n"), [
    ["a", "b", "c"],
    ["1", "", "3"],
  ]);
});

test("tabs: for .tsv files, and for text with tabs but no commas", () => {
  assert.deepEqual(parseCsv("a,b\tc", "x.tsv"), [["a,b", "c"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.deepEqual(parseCsv("a,b\tc"), [["a", "b\tc"]]);
});

test("the table: a header row, short rows filled", () => {
  assert.deepEqual(csvToTable("a,b,c\n1,2\n"), {
    block: {
      type: "table",
      content: {
        type: "tableContent",
        headerRows: 1,
        rows: [{ cells: ["a", "b", "c"] }, { cells: ["1", "2", ""] }],
      },
    },
    truncated: false,
  });
  assert.equal(csvToTable("only\n")!.block.content.headerRows, undefined);
  assert.equal(csvToTable("\n \n"), null);
});

test("over the limits: cut off, and said so", () => {
  const many = Array.from({ length: MAX_CSV_ROWS + 5 }, (_, i) => `${i},x`).join("\n");
  const rows = csvToTable(many)!;
  assert.equal(rows.block.content.rows.length, MAX_CSV_ROWS);
  assert.equal(rows.truncated, true);
  const wide = csvToTable(Array.from({ length: MAX_CSV_COLUMNS + 1 }, (_, i) => i).join(","))!;
  assert.equal(wide.block.content.rows[0].cells.length, MAX_CSV_COLUMNS);
  assert.equal(wide.truncated, true);
});
