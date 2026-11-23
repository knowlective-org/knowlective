import * as Y from "yjs";
import { SLIDE_FRAME } from "@/lib/presentation";
import { isBox, readItems, readSlideBackground } from "@/lib/whiteboard";
import { whiteboardSvg } from "@/components/whiteboard/export";
import { imageData, themeColors } from "@/components/whiteboard/export-download";

// Presenting draws the slide in the page, to have the slides' own font.
const SCREEN_FONT = "var(--font-slide), sans-serif";

// A slide's content as SVG markup for the presentation screen. Every text
// and attribute in it is escaped by whiteboardSvg().
export async function slideMarkup(state: string): Promise<{ svg: string; onImage: boolean }> {
  const { items, background, images, colors } = await slideContent(state);
  const svg = whiteboardSvg(items, colors, images, SLIDE_FRAME, { font: SCREEN_FONT, background }).svg;
  return { svg, onImage: !!background.image };
}

// The slide's items, background and images (data: URLs).
async function slideContent(state: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(atob(state), (c) => c.charCodeAt(0)));
  const items = readItems(doc);
  const stored = readSlideBackground(doc);
  doc.destroy();
  const srcs = [...new Set([...items.flatMap((i) => (isBox(i) && i.src ? [i.src] : [])), ...(stored.image ? [stored.image] : [])])];
  const images = await imageData(srcs);
  const colors = themeColors();
  const background = {
    color: stored.color ? colors.items[stored.color] : undefined,
    image: stored.image ? images.get(stored.image) : undefined,
  };
  return { items, background, images, colors };
}

// A slide's content (a base64 Yjs state) as a picture for the slide list.
// An <img> of a data: URL: nothing in it can run or reach the page.
export async function slideThumbnail(state: string): Promise<string> {
  const { items, background, images, colors } = await slideContent(state);
  const { svg } = whiteboardSvg(items, colors, images, SLIDE_FRAME, { background });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
