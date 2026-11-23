import { type NumberPosition, SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/presentation";

// A presentation as Typst markup, one page per slide (slide-pdf-export.ts
// compiles it in the browser). Shapes are vector layers (SVG files); text is
// placed piece by piece where the browser laid it out, so it breaks into
// lines as on screen and stays real text in the PDF. No DOM here (unit test:
// test/slide-pdf.test.mts). `strLit` is the exporter's Typst string literal,
// passed in: that package can't be loaded from this module in the unit tests.

// Slide pixels to PDF points: a 960 × 540 pt page.
const PT = 0.5;
const pt = (px: number) => `${(Math.round(px * PT * 100) / 100).toString()}pt`;

export const SLIDE_FONTS = ["Noto Sans JP", "Noto Sans KR", "Noto Emoji"];

// One run of text on one line, in slide pixels.
export type TextFragment = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  highlight: string | null;
};

// Back to front: a vector layer (a file among the compiler's assets), then
// the text on it.
export type SlideLayer = { asset: string | null; fragments: TextFragment[] };

// `onImage`: the slide's background is a picture (the number gets a plate).
export type PdfSlide = { layers: SlideLayer[]; number: number | null; onImage?: boolean };

// A CSS color from the browser as Typst's rgb(); null for a transparent one
// (or anything else, which is never put in the markup).
export function typstColor(css: string): string | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) return `rgb("#${hex[1].toLowerCase()}")`;
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(css.trim());
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if (!(alpha > 0)) return null;
  const channels = [m[1], m[2], m[3]].map(Number);
  if (channels.some((c) => c > 255)) return null;
  return `rgb("#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}")`;
}

const place = (x: number, y: number, content: string) => `#place(top + left, dx: ${pt(x)}, dy: ${pt(y)}, ${content})\n`;

type StrLit = (text: string) => string;

function fragmentTypst(f: TextFragment, ink: string, strLit: StrLit): string {
  let out = "";
  const highlight = f.highlight ? typstColor(f.highlight) : null;
  if (highlight) out += place(f.x, f.y, `rect(width: ${pt(f.w)}, height: ${pt(f.h)}, fill: ${highlight}, stroke: none)`);
  const color = typstColor(f.color) ?? ink;
  // The box of the text is the font's ascent to descent, as in the browser.
  const text =
    `text(size: ${pt(f.size)}, fill: ${color}, weight: ${f.bold ? 700 : 400}, ` +
    `top-edge: "ascender", bottom-edge: "descender", cjk-latin-spacing: none, ${strLit(f.text)})`;
  // Noto Sans JP has no italic of its own.
  out += place(f.x, f.y, f.italic ? `skew(ax: -12deg, origin: bottom + left, ${text})` : text);
  const line = (y: number) =>
    place(f.x, y, `line(length: ${pt(f.w)}, stroke: ${pt(Math.max(1, f.size / 14))} + ${color})`);
  if (f.underline) out += line(f.y + f.h * 0.86);
  if (f.strike) out += line(f.y + f.h * 0.54);
  return out;
}

// The slide's number, above everything, with room around it.
function numberTypst(number: number, position: NumberPosition, board: string, ink: string, strLit: StrLit, onImage: boolean): string {
  const align = position === "left" ? "left" : position === "center" ? "center" : "right";
  const dx = position === "left" ? pt(48) : position === "right" ? pt(-48) : "0pt";
  return (
    `#place(bottom + ${align}, dx: ${dx}, dy: ${pt(-32)}, ` +
    `box(fill: ${onImage ? `${board}.transparentize(20%)` : "none"}, radius: ${pt(6)}, inset: (x: ${pt(onImage ? 20 : 14)}, y: ${pt(onImage ? 8 : 4)}), ` +
    `text(size: ${pt(32)}, fill: ${ink}, ${strLit(String(number))})))\n`
  );
}

export function presentationTypst(
  slides: PdfSlide[],
  options: { title: string; lang: string; board: string; ink: string; position: NumberPosition },
  strLit: StrLit,
): string {
  const board = typstColor(options.board) ?? `rgb("#ffffff")`;
  const ink = typstColor(options.ink) ?? `rgb("#1f2328")`;
  const head =
    `#set document(title: ${strLit(options.title)})\n` +
    `#set page(width: ${pt(SLIDE_WIDTH)}, height: ${pt(SLIDE_HEIGHT)}, margin: 0pt, fill: ${board})\n` +
    `#set text(font: (${SLIDE_FONTS.map((f) => strLit(f)).join(", ")}), lang: ${strLit(options.lang === "ja" ? "ja" : "en")})\n`;
  const pages = slides.map((slide) => {
    let out = "";
    for (const layer of slide.layers) {
      if (layer.asset) out += `#place(top + left, image(${strLit(layer.asset)}, width: ${pt(SLIDE_WIDTH)}, height: ${pt(SLIDE_HEIGHT)}))\n`;
      for (const f of layer.fragments) out += fragmentTypst(f, ink, strLit);
    }
    if (slide.number !== null) out += numberTypst(slide.number, options.position, board, ink, strLit, !!slide.onImage);
    // An empty slide is still a page.
    return out || "#box()\n";
  });
  return head + pages.join("#pagebreak()\n");
}
