import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { tocHeadings } from "../src/components/editor/toc";
import { prepareBlocksForExport } from "../src/components/editor/markdown-export";

// The table of contents block's headings, and how it's exported.
//   pnpm --filter web test:unit

const heading = (id: string, level: number, text: string, children: unknown[] = []) => ({
  id,
  type: "heading",
  props: { level },
  content: [{ type: "text", text, styles: {} }],
  children,
});
const paragraph = (id: string, text: string, children: unknown[] = []) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children });

describe("table of contents", () => {
  const blocks = [
    heading("a", 2, "Overview"),
    paragraph("p", "text", [heading("b", 3, "Nested in a toggle")]),
    heading("c", 4, "  Spaced   out  "),
    heading("d", 2, ""),
    { id: "t", type: "toc", props: {}, content: undefined, children: [] },
    heading("e", 3, "Last"),
  ];

  test("every heading in page order, nested ones too, empty ones left out", () => {
    assert.deepEqual(
      tocHeadings(blocks as never).map((h) => [h.id, h.level, h.text]),
      [
        ["a", 2, "Overview"],
        ["b", 3, "Nested in a toggle"],
        ["c", 4, "Spaced out"],
        ["e", 3, "Last"],
      ],
    );
  });

  test("exported as a bulleted list of the headings, nested by level", () => {
    const out = prepareBlocksForExport(blocks as never, { origin: "https://x", pageId: "p", childPages: [], untitled: "Untitled" });
    const toc = out.slice(out.findIndex((b) => b.type === "bulletListItem"));
    const textOf = (b: { content?: unknown }) => (b.content as { text: string }[]).map((c) => c.text).join("");
    const outline = (list: typeof out, depth = 0): string[] =>
      list.filter((b) => b.type === "bulletListItem").flatMap((b) => [`${"  ".repeat(depth)}${textOf(b)}`, ...outline(b.children ?? [], depth + 1)]);
    assert.deepEqual(outline(toc), ["Overview", "  Nested in a toggle", "      Spaced   out  ", "  Last"]);
  });
});
