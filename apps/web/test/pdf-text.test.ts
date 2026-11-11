import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type PdfPiece, pdfBlocks, pdfLines, pdfTitle } from "../src/components/editor/pdf-text";

// A PDF's text as blocks (components/editor/pdf-text.ts), for expanding a PDF
// into a page or replacing the page with it.

// One line of text at `y`, in pieces of `size`.
const line = (y: number, text: string, size = 10): PdfPiece[] => [{ text, x: 50, y, size, endOfLine: true }];

describe("PDF text", () => {
  test("pieces become lines: where pdf.js ends one, or the text moves to another height", () => {
    const lines = pdfLines([
      { text: "Hello", x: 50, y: 700, size: 10 },
      { text: " ", x: 75, y: 700, size: 10 },
      { text: "world", x: 80, y: 700, size: 10 },
      { text: "Next", x: 50, y: 686, size: 10 },
      { text: "line", x: 50, y: 672, size: 10, endOfLine: true },
      { text: "  ", x: 50, y: 660, size: 10, endOfLine: true },
    ]);
    assert.deepEqual(
      lines.map((l) => l.text),
      ["Hello world", "Next", "line"],
    );
  });

  test("lines become headings, paragraphs and list items", () => {
    const page = pdfLines([
      ...line(760, "報告書", 24),
      ...line(720, "概要", 14),
      ...line(700, "この文書は、"),
      ...line(688, "テストのための文書です。"),
      ...line(660, "Second paragraph that is"),
      ...line(648, "long enough to wrap."),
      ...line(620, "• 一つ目"),
      ...line(608, "• 二つ目"),
      ...line(596, "1. 手順"),
    ]);
    assert.deepEqual(pdfBlocks([page]), [
      { type: "heading", props: { level: 2 }, content: "報告書" },
      { type: "heading", props: { level: 3 }, content: "概要" },
      { type: "paragraph", content: "この文書は、テストのための文書です。" },
      { type: "paragraph", content: "Second paragraph that is long enough to wrap." },
      { type: "bulletListItem", content: "一つ目" },
      { type: "bulletListItem", content: "二つ目" },
      { type: "numberedListItem", content: "手順" },
    ]);
  });

  test("a word broken with a hyphen is joined again; pages don't run together", () => {
    const one = pdfLines([...line(700, "an exam-"), ...line(688, "ple of text")]);
    const two = pdfLines([...line(700, "Next page")]);
    assert.deepEqual(
      pdfBlocks([one, two]).map((b) => b.content),
      ["an example of text", "Next page"],
    );
  });

  test("nothing: no blocks (a scanned PDF has no text)", () => {
    assert.deepEqual(pdfBlocks([[], []]), []);
  });

  test("the title: the first heading, or the file's name", () => {
    const blocks = pdfBlocks([pdfLines([...line(760, "報告書", 24), ...line(700, "本文はここに書いてあります")])]);
    assert.deepEqual(pdfTitle(blocks, "a.pdf"), { title: "報告書", blocks: [{ type: "paragraph", content: "本文はここに書いてあります" }] });
    assert.equal(pdfTitle([{ type: "paragraph", content: "本文" }], "議事録.PDF").title, "議事録");
  });
});
