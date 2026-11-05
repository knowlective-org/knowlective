import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { blocksToMarkdown, blocksToUpdate, stateToBlocks } from "../server/markdown-engine.mjs";

// A code block's preview setting (components/editor/code-block.ts) is kept by
// the server's schema (the public API reads and writes page documents with
// it), and Markdown still gets the code.
//   pnpm --filter web test:unit

describe("code block preview on the server", () => {
  test("the preview prop survives a round trip, and Markdown has the code", async () => {
    const block = {
      type: "codeBlock",
      props: { language: "html", preview: "only" },
      content: [{ type: "text", text: "<b>hi</b>", styles: {} }],
    };
    const [read] = stateToBlocks(blocksToUpdate([block])) as (typeof block)[];
    assert.equal(read.props.preview, "only");
    assert.equal(read.props.language, "html");
    assert.match(await blocksToMarkdown([read]), /```html\n<b>hi<\/b>\n```/);
  });
});
