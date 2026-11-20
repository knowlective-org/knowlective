import { test } from "node:test";
import assert from "node:assert/strict";
import { tableClipboard } from "../src/lib/clipboard-table";

test("rows and cells: tab-separated lines and an HTML table", () => {
  const { plain, html } = tableClipboard([
    ["a", "b"],
    ["c", ""],
  ]);
  assert.equal(plain, "a\tb\nc\t");
  assert.equal(html, "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td></td></tr></table>");
});

test("a cell with a tab, a line break or a quote is quoted, as spreadsheets do", () => {
  assert.equal(tableClipboard([["x\ty", "two\nlines", 'say "hi"', "plain"]]).plain, '"x\ty"\t"two\nlines"\t"say ""hi"""\tplain');
});

test("HTML in a cell is text, line breaks become <br>", () => {
  assert.equal(tableClipboard([["<b>&</b>\nnext"]]).html, "<table><tr><td>&lt;b&gt;&amp;&lt;/b&gt;<br>next</td></tr></table>");
});
