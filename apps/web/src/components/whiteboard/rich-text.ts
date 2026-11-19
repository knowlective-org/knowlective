// Lists in whiteboard text (notes, shapes, text, connector labels). The text
// stays plain — it's what's stored, searched and edited — and lines are shown
// as lists by how they start: "- ", "* ", "• " or "・" for a bulleted list,
// "1. " (or "1) ") for a numbered one. Parts of the text may be styled
// (lib/whiteboard-marks.ts). No dependencies, for the unit tests.

export type TextBlock =
  | { kind: "text"; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "number"; start: number; items: string[] };

const BULLET = /^(\s*)(?:[-*•]\s+|・\s*)(.*)$/;
const NUMBER = /^(\s*)(\d{1,4})[.)．]\s+(.*)$/;

type Line = { kind: "text"; text: string } | { kind: "bullet"; text: string } | { kind: "number"; n: number; text: string };

function readLine(line: string): Line {
  const n = NUMBER.exec(line);
  if (n) return { kind: "number", n: Number(n[2]), text: n[3] };
  const b = BULLET.exec(line);
  if (b) return { kind: "bullet", text: b[2] };
  return { kind: "text", text: line };
}

// Where each part is in the text (for its styles: lib/whiteboard-marks.ts):
// a run of plain lines, or each item's words (after its bullet or number).
type Span = { from: number; to: number };
export type TextBlockAt =
  | { kind: "text"; span: Span }
  | { kind: "bullet"; items: Span[] }
  | { kind: "number"; start: number; items: Span[] };

export function parseRichTextAt(text: string): TextBlockAt[] {
  const blocks: TextBlockAt[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    const line = readLine(raw);
    const lineStart = offset;
    offset += raw.length + 1;
    const last = blocks[blocks.length - 1];
    if (line.kind === "text") {
      if (last?.kind === "text") last.span.to = lineStart + raw.length;
      else blocks.push({ kind: "text", span: { from: lineStart, to: lineStart + raw.length } });
      continue;
    }
    // The item's words are the end of the line.
    const item = { from: lineStart + raw.length - line.text.length, to: lineStart + raw.length };
    if (line.kind === "bullet") {
      if (last?.kind === "bullet") last.items.push(item);
      else blocks.push({ kind: "bullet", items: [item] });
    } else if (last?.kind === "number") {
      last.items.push(item);
    } else {
      blocks.push({ kind: "number", start: line.n, items: [item] });
    }
  }
  return blocks;
}

// The text as blocks: runs of plain lines, and lists (a numbered list starts
// at its first item's number).
export function parseRichText(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = readLine(raw);
    const last = blocks[blocks.length - 1];
    if (line.kind === "text") {
      if (last?.kind === "text") last.text += `\n${line.text}`;
      else blocks.push({ kind: "text", text: line.text });
    } else if (line.kind === "bullet") {
      if (last?.kind === "bullet") last.items.push(line.text);
      else blocks.push({ kind: "bullet", items: [line.text] });
    } else if (last?.kind === "number") {
      last.items.push(line.text);
    } else {
      blocks.push({ kind: "number", start: line.n, items: [line.text] });
    }
  }
  return blocks;
}

// Enter at the end of `line` (the line the caret is on): "continue" with the
// next item's start ("- ", or the next number), "end" the list when the item
// is empty (its start is taken away), or null for a plain new line.
export function enterInList(line: string): { continue: string } | { end: true } | null {
  const n = NUMBER.exec(line);
  if (n) return n[3].trim() ? { continue: `${n[1]}${Number(n[2]) + 1}. ` } : { end: true };
  const b = BULLET.exec(line);
  if (b) {
    const marker = /^\s*(\S)/.exec(line)![1];
    return b[2].trim() ? { continue: `${b[1]}${marker === "・" ? "・" : `${marker} `}` } : { end: true };
  }
  return null;
}

// The whole text made a list of `kind` (each line that has words an item,
// numbered from 1), or back to plain lines when it already is one.
export function toggleList(text: string, kind: "bullet" | "number"): string {
  const lines = text.split("\n").map(readLine);
  const filled = lines.filter((l) => l.text.trim());
  if (filled.length > 0 && filled.every((l) => l.kind === kind)) return lines.map((l) => l.text).join("\n");
  let n = 0;
  return lines.map((l) => (l.text.trim() ? (kind === "bullet" ? `- ${l.text}` : `${++n}. ${l.text}`) : l.text)).join("\n");
}
