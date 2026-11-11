// A PDF's text as blocks, for expanding a PDF into a page or replacing the
// page with it. pdf.js gives positioned pieces of text (pdf-import.ts reads
// them); this puts them back into lines, the lines into paragraphs, and takes
// text clearly larger than the body's for headings and lines starting with a
// bullet for list items. Images, tables and columns aren't recognised: the
// text comes in the order the PDF holds it.
// No dependencies (unit tests: test/pdf-text.test.ts).

// A piece of text as pdf.js gives it: `x`, `y` (from the bottom of the
// page) and `size` (the font's height) in the page's units.
export type PdfPiece = { text: string; x: number; y: number; size: number; endOfLine?: boolean };

type Line = { text: string; y: number; size: number };

export type PdfBlock = { type: "heading" | "paragraph" | "bulletListItem" | "numberedListItem"; props?: { level: number }; content: string };

const CJK = /[　-鿿豈-﫿＀-￯]/;

// Joins two pieces of text: Japanese and Chinese without a space; a word
// broken with a hyphen at the end of a line back together.
function join(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  if (CJK.test(a.at(-1)!) || CJK.test(b[0]) || /\s$/.test(a) || /^\s/.test(b)) return a + b;
  return `${a} ${b}`;
}

// A page's pieces as lines: a new line where pdf.js says one ends or where
// the text moves up or down by more than half its size.
export function pdfLines(pieces: PdfPiece[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  let lastX = -Infinity;
  for (const piece of pieces) {
    const size = piece.size > 0 ? piece.size : 10;
    if (current && (Math.abs(piece.y - current.y) > Math.max(size, current.size) * 0.5 || piece.x < lastX - size * 2)) {
      lines.push(current);
      current = null;
    }
    if (piece.text !== "") {
      if (!current) current = { text: piece.text, y: piece.y, size };
      else {
        // Pieces on one line, one after another (pdf.js gives the spaces).
        current.text += piece.text;
        current.size = Math.max(current.size, size);
      }
      lastX = piece.x;
    }
    if (piece.endOfLine && current) {
      lines.push(current);
      current = null;
      lastX = -Infinity;
    }
  }
  if (current) lines.push(current);
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text !== "");
}

const BULLET = /^[•・●○◦▪■□\-–*]\s*/;
const NUMBERED = /^(\d{1,3})[.)．）]\s+/;

// The pages' lines as blocks. Lines close together and the same size form a
// paragraph; a gap, a change of size or a bullet starts a new block. Text
// at least 1.5× the body's is a heading (H2), at least 1.2× H3.
export function pdfBlocks(pages: Line[][]): PdfBlock[] {
  const all = pages.flat();
  if (all.length === 0) return [];
  // The body's size: the one most of the text is in.
  const bySize = new Map<number, number>();
  for (const l of all) {
    const key = Math.round(l.size * 2) / 2;
    bySize.set(key, (bySize.get(key) ?? 0) + l.text.length);
  }
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const levelOf = (size: number) => (size >= body * 1.5 ? 2 : size >= body * 1.2 ? 3 : 0);

  const blocks: PdfBlock[] = [];
  for (const lines of pages) {
    let block: PdfBlock | null = null;
    let prev: Line | null = null;
    const end = () => {
      if (block && block.content.trim()) blocks.push({ ...block, content: block.content.trim() });
      block = null;
    };
    for (const line of lines) {
      const level = levelOf(line.size);
      const gap = prev ? prev.y - line.y : 0;
      const sameKind =
        block !== null &&
        prev !== null &&
        level === levelOf(prev.size) &&
        Math.abs(line.size - prev.size) < body * 0.1 &&
        gap > 0 &&
        gap < Math.max(line.size, prev.size) * 1.8;
      const bullet = level === 0 && BULLET.test(line.text);
      const numbered = level === 0 && NUMBERED.test(line.text);
      if (bullet || numbered || !sameKind) end();
      if (bullet) block = { type: "bulletListItem", content: line.text.replace(BULLET, "") };
      else if (numbered) block = { type: "numberedListItem", content: line.text.replace(NUMBERED, "") };
      else if (!block) block = level > 0 ? { type: "heading", props: { level }, content: line.text } : { type: "paragraph", content: line.text };
      else block.content = join(block.content, line.text);
      prev = line;
    }
    end();
  }
  return blocks;
}

// The title for replacing a page: the first heading, or the file's name
// without ".pdf"; the heading is then taken out of the blocks.
export function pdfTitle(blocks: PdfBlock[], fileName: string): { title: string; blocks: PdfBlock[] } {
  const first = blocks[0];
  if (first?.type === "heading") return { title: first.content, blocks: blocks.slice(1) };
  return { title: fileName.replace(/\.pdf$/i, ""), blocks };
}
