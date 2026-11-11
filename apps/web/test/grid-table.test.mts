import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { blocksToMarkdown, blocksToUpdate, stateToBlocks } from "../server/markdown-engine.mjs";
import { prepareBlocksForExport } from "../src/components/editor/markdown-export";
import { gridWidths } from "../src/components/editor/grid-table-config";

// The extended table (cells holding blocks) on the server: kept whole when a
// page's document is read and written (the public API), and written to
// Markdown as a table of the cells' text.
//   pnpm --filter web test:unit

const text = (t: string) => [{ type: "text", text: t, styles: {} }];
const cell = (...children: unknown[]) => ({ type: "gridCell", children });
const table = {
  type: "gridTable",
  props: { headerRow: true, headerColumn: false, widths: "[2,1]" },
  children: [
    { type: "gridRow", children: [cell({ type: "paragraph", content: text("項目") }), cell({ type: "paragraph", content: text("説明") })] },
    {
      type: "gridRow",
      children: [
        cell({ type: "paragraph", content: text("検索") }),
        cell(
          { type: "paragraph", content: text("本文") },
          { type: "bulletListItem", content: text("添付ファイル") },
        ),
      ],
    },
  ],
};

describe("extended table", () => {
  test("survives the server's document round trip", () => {
    const blocks = stateToBlocks(blocksToUpdate([table])) as typeof table[];
    assert.equal(blocks[0].type, "gridTable");
    assert.equal(blocks[0].props.widths, "[2,1]");
    assert.equal(blocks[0].children.length, 2);
    const second = blocks[0].children[1].children[1] as { children: { type: string }[] };
    assert.deepEqual(second.children.map((b) => b.type), ["paragraph", "bulletListItem"]);
  });

  test("is written to Markdown as a table of the cells' text", async () => {
    const prepared = prepareBlocksForExport([table] as never, {
      origin: "https://example.com",
      pageId: "p",
      childPages: null,
      untitled: "Untitled",
    });
    assert.equal(prepared[0].type, "table");
    const markdown = await blocksToMarkdown(prepared);
    assert.match(markdown, /\|\s*項目\s*\|\s*説明\s*\|/);
    assert.match(markdown, /\|\s*検索\s*\|\s*本文 添付ファイル\s*\|/);
  });

  test("its summary row is written as a last row, the functions named as in a spreadsheet", async () => {
    const numbers = {
      type: "gridTable",
      props: { headerRow: true, headerColumn: false, widths: "", summary: JSON.stringify([{ fn: "counta" }, { fn: "sum" }]) },
      children: [
        { type: "gridRow", children: [cell({ type: "paragraph", content: text("品目") }), cell({ type: "paragraph", content: text("金額") })] },
        { type: "gridRow", children: [cell({ type: "paragraph", content: text("A") }), cell({ type: "paragraph", content: text("1,000") })] },
        { type: "gridRow", children: [cell({ type: "paragraph", content: text("B") }), cell({ type: "paragraph", content: text("250") })] },
      ],
    };
    // The summary prop survives the server's round trip too.
    const [back] = stateToBlocks(blocksToUpdate([numbers])) as (typeof numbers)[];
    assert.equal(back.props.summary, numbers.props.summary);
    const prepared = prepareBlocksForExport([numbers] as never, { origin: "https://example.com", pageId: "p", childPages: null, untitled: "Untitled" });
    const markdown = await blocksToMarkdown(prepared);
    assert.match(markdown, /COUNTA: 2/);
    assert.match(markdown, /SUM: 1,250/);
  });

  test("column widths: one per column, 1 where missing or invalid", () => {
    assert.deepEqual(gridWidths("[2,1]", 3), [2, 1, 1]);
    assert.deepEqual(gridWidths("not json", 2), [1, 1]);
    assert.deepEqual(gridWidths("[-1, 0, \"x\", 1e9]", 4), [1, 1, 1, 1000]);
    assert.deepEqual(gridWidths("", 1), [1]);
  });
});
