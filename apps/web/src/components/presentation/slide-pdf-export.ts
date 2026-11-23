import { strLit } from "@blocknote/xl-pdf-exporter";
import { TypstCompiler } from "@blocknote/xl-typst-compiler";
import * as Y from "yjs";
import { loadPresentation, loadSlideStates } from "@/app/(app)/pages/[pageId]/presentation-actions";
import { downloadBlob } from "@/components/editor/markdown-export";
import { type ExportColors, whiteboardSvg } from "@/components/whiteboard/export";
import { themeColors } from "@/components/whiteboard/export-download";
import { resolveAppUrl, withBasePath } from "@/lib/base-path";
import { exportFileName } from "@/lib/page-export";
import { SLIDE_FRAME, SLIDE_WIDTH, shownSlides } from "@/lib/presentation";
import { type BoxItem, type SlideBackground, type WhiteboardItem, isBox, readItems, readSlideBackground } from "@/lib/whiteboard";
import { type PdfSlide, SLIDE_FONTS, type SlideLayer, type TextFragment, presentationTypst } from "./slide-pdf";

// A presentation's PDF, made in the browser: the server only hands out the
// slides the viewer can get. Loaded when someone exports.

const asset = (name: string) => withBasePath(`/api/export-assets/${name}`);
const STATES_PER_REQUEST = 24;
const CSS_FONT = `${SLIDE_FONTS.map((f) => `"${f}"`).join(", ")}, sans-serif`;
const TYPST_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿]/u;
const EMOJI = /\p{Extended_Pictographic}/u;

type FontFile = { family: string; file: string; weight: string };
const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
const notoFont = (lang: "JP" | "KR", weight: number): FontFile => ({
  family: `Noto Sans ${lang}`,
  file: `NotoSans${lang}-${WEIGHT_NAMES[weight]}.ttf`,
  weight: String(weight),
});
// CSS's "bolder" (a bold part of a text in a box of that weight).
const bolder = (weight: number) => (weight < 400 ? 400 : weight < 600 ? 700 : 900);
const EMOJI_FONT: FontFile[] = [{ family: "Noto Emoji", file: "NotoEmoji-Regular.ttf", weight: "400" }];

// Kept for the page's lifetime: they're large. Each is given to both the
// browser (to lay out the text) and the compiler (to draw it).
const loadedFonts = new Map<string, Promise<Uint8Array>>();
function loadFont(font: FontFile): Promise<Uint8Array> {
  let loading = loadedFonts.get(font.file);
  if (!loading) {
    loading = (async () => {
      const res = await fetch(asset(font.file));
      if (!res.ok) throw new Error(`font ${font.file}: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const face = new FontFace(font.family, bytes, { weight: font.weight });
      await face.load();
      document.fonts.add(face);
      return bytes;
    })();
    loadedFonts.set(font.file, loading);
    // A failed download is tried again on the next export.
    loading.catch(() => loadedFonts.delete(font.file));
  }
  return loading;
}

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// An attachment, with the viewer's session, in a format the compiler reads.
async function loadImage(src: string): Promise<string | null> {
  try {
    const res = await fetch(resolveAppUrl(src));
    if (!res.ok) return null;
    const blob = await res.blob();
    if (TYPST_IMAGE_TYPES.includes(blob.type)) return await asDataUrl(blob);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// The text in `root` as it's laid out: a piece for each run on each line.
function readFragments(root: Element, origin: DOMRect): TextFragment[] {
  const out: TextFragment[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent) continue;
    const css = getComputedStyle(parent);
    const decoration = css.textDecorationLine;
    const background = css.backgroundColor;
    const style = {
      size: parseFloat(css.fontSize),
      color: css.color,
      weight: Number(css.fontWeight) || 400,
      italic: css.fontStyle === "italic",
      underline: decoration.includes("underline"),
      strike: decoration.includes("line-through"),
      highlight: background === "rgba(0, 0, 0, 0)" || background === "transparent" ? null : background,
    };
    let piece: TextFragment | null = null;
    const finish = () => {
      if (piece && piece.text.trim()) out.push({ ...piece, text: piece.text.trimEnd() });
      piece = null;
    };
    for (const { segment, index } of graphemes.segment(node.data)) {
      if (segment === "\n") {
        finish();
        continue;
      }
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const rect = [...range.getClientRects()].find((r) => r.width > 0);
      if (!rect) continue;
      const x = rect.left - origin.left;
      const y = rect.top - origin.top;
      const current: TextFragment | null = piece;
      if (current && Math.abs(current.y - y) < 1) {
        current.text += segment;
        current.w = x + rect.width - current.x;
      } else {
        finish();
        // Spaces at the start of a wrapped line aren't drawn.
        if (!segment.trim()) continue;
        piece = { ...style, text: segment, x, y, w: rect.width, h: rect.height };
      }
    }
    finish();
  }
  return out;
}

// Neighbouring layers with no text between them go in one file.
function mergeLayers(layers: { shapes: string; text: string }[]) {
  const merged: { shapes: string; text: string }[] = [];
  for (const layer of layers) {
    if (!layer.shapes && !layer.text) continue;
    const last = merged[merged.length - 1];
    if (last && !last.text) {
      last.shapes += layer.shapes;
      last.text = layer.text;
    } else {
      merged.push({ ...layer });
    }
  }
  return merged;
}

function layOut(
  items: WhiteboardItem[],
  colors: ExportColors,
  images: Map<string, string>,
  host: HTMLElement,
  addAsset: (svg: string) => string,
  stored: SlideBackground,
): SlideLayer[] {
  const background = {
    color: stored.color ? colors.items[stored.color] : undefined,
    image: stored.image ? images.get(stored.image) : undefined,
  };
  const result = whiteboardSvg(items, colors, images, SLIDE_FRAME, { font: CSS_FONT, plainLists: true, noShadow: true, background });
  const layers = mergeLayers(result.layers);
  host.innerHTML = result.layerSvg(layers.map((l, i) => `<g data-layer="${i}">${l.text}</g>`).join(""));
  const svg = host.firstElementChild!;
  const box = svg.getBoundingClientRect();
  // At full size, so the positions are the slide's.
  const scale = box.width / SLIDE_WIDTH;
  const fragments = (i: number) => {
    const g = svg.querySelector(`[data-layer="${i}"]`);
    if (!g) return [];
    return readFragments(g, box).map((f) => ({ ...f, x: f.x / scale, y: f.y / scale, w: f.w / scale, h: f.h / scale }));
  };
  return layers.map((layer, i) => ({
    asset: layer.shapes ? addAsset(result.layerSvg(layer.shapes)) : null,
    fragments: fragments(i),
  }));
}

export class NoSlidesToExport extends Error {}

export async function exportPresentationPdf(deckId: string, title: string, lang: string): Promise<void> {
  const deck = await loadPresentation(deckId);
  if (!deck) throw new Error("No presentation");
  const ids = shownSlides(deck.slides.map((s) => s.id), deck.settings);
  if (ids.length === 0) throw new NoSlidesToExport();
  const numbers = new Map(deck.slides.map((s) => [s.id, s.number]));

  const states = new Map<string, string>();
  for (let i = 0; i < ids.length; i += STATES_PER_REQUEST) {
    for (const { id, state } of await loadSlideStates(deckId, ids.slice(i, i + STATES_PER_REQUEST))) states.set(id, state);
  }
  const contents = ids.map((id) => {
    const doc = new Y.Doc();
    const state = states.get(id);
    if (state) Y.applyUpdate(doc, Uint8Array.from(atob(state), (c) => c.charCodeAt(0)));
    const items = readItems(doc);
    const background = readSlideBackground(doc);
    doc.destroy();
    return { id, items, background };
  });

  // The fonts this presentation's text needs.
  const text = contents
    .flatMap((c) => c.items)
    .map((i) => ("text" in i ? `${i.text}${"startText" in i ? `${i.startText}${i.endText}` : ""}` : ""))
    .join("");
  // Each weight is ~6MB: only those in use.
  const weights = new Set([400, 700]);
  for (const item of contents.flatMap((c) => c.items)) {
    if (!isBox(item) || !item.fontWeight) continue;
    weights.add(item.fontWeight);
    if (item.textMarks.some((m) => m.bold)) weights.add(bolder(item.fontWeight));
  }
  const fonts = [
    ...[...weights].map((w) => notoFont("JP", w)),
    ...(HANGUL.test(text) ? [...weights].map((w) => notoFont("KR", w)) : []),
    ...(EMOJI.test(text) ? EMOJI_FONT : []),
  ];
  const fontBytes = await Promise.all(fonts.map(loadFont));
  await document.fonts.ready;

  const srcs = [
    ...new Set(
      contents.flatMap((c) => [
        ...c.items.filter((i): i is BoxItem => isBox(i) && !!i.src).map((i) => i.src),
        ...(c.background.image ? [c.background.image] : []),
      ]),
    ),
  ];
  const images = new Map<string, string>();
  await Promise.all(
    srcs.map(async (src) => {
      const data = await loadImage(src);
      if (data) images.set(src, data);
    }),
  );

  const assets = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  // Out of sight, laid out at full size.
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${SLIDE_WIDTH}px;visibility:hidden;pointer-events:none`;
  document.body.append(host);
  const colors = themeColors();
  let slides: PdfSlide[];
  try {
    slides = contents.map(({ id, items, background }, s) => {
      let n = 0;
      const layers = layOut(items, colors, images, host, (svg) => {
        const path = `/assets/slide-${s}-${n++}.svg`;
        assets.set(path, encoder.encode(svg));
        return path;
      }, background);
      return { layers, number: numbers.get(id) ?? null, onImage: !!(background.image && images.has(background.image)) };
    });
  } finally {
    host.remove();
  }

  const source = presentationTypst(slides, { title, lang, board: colors.board, ink: colors.ink, position: deck.settings.numberPosition }, strLit);
  const compiler = await TypstCompiler.create({ wasm: asset("typst.wasm"), fonts: fontBytes });
  const result = compiler.compilePdf(source, { assets, tagged: false });
  if (result.error) throw new Error(result.compileErrors.map((e) => e.message).join("\n") || "PDF compile failed");
  downloadBlob(exportFileName(title, "pdf"), new Blob([new Uint8Array(result.pdf)], { type: "application/pdf" }));
}
