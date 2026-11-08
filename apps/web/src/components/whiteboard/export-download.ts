import type * as Y from "yjs";
import { downloadBlob } from "@/components/editor/markdown-export";
import { resolveAppUrl } from "@/lib/base-path";
import { exportFileName } from "@/lib/page-export";
import { ITEM_COLORS, type ItemColor, isBox, readItems } from "@/lib/whiteboard";
import { type ExportColors, whiteboardSvg } from "./export";

// The page menu's whiteboard export, in the browser: the board as it is now,
// in the colors on screen (the theme's), as an SVG file or a PNG image. The
// images are fetched with the viewer's own access and put in the file.

// A PNG is drawn at twice the size, within what browsers can draw on a canvas.
const PNG_SCALE = 2;
const MAX_CANVAS_SIDE = 16_000;
const MAX_CANVAS_AREA = 120_000_000;

function themeColors(): ExportColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    items: Object.fromEntries(ITEM_COLORS.map((c) => [c, v(`--color-wb-${c}`, "#ffffff")])) as Record<ItemColor, string>,
    board: v("--color-wb-board", "#ffffff"),
    ink: v("--color-wb-ink", "#1f2328"),
    line: v("--color-wb-line", "#5b6470"),
    muted: v("--color-muted", "#687280"),
  };
}

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// The board's images as data: URLs, by src. One that can't be fetched is
// left out (drawn as a gray box).
async function imageData(srcs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    srcs.map(async (src) => {
      try {
        const res = await fetch(resolveAppUrl(src));
        if (res.ok) out.set(src, await asDataUrl(await res.blob()));
      } catch {
        // Left out.
      }
    }),
  );
  return out;
}

export async function exportWhiteboard(doc: Y.Doc, format: "svg" | "png", title: string): Promise<void> {
  const items = readItems(doc);
  const srcs = [...new Set(items.flatMap((i) => (isBox(i) && i.src ? [i.src] : [])))];
  const { svg, width, height } = whiteboardSvg(items, themeColors(), await imageData(srcs));
  if (format === "svg") {
    downloadBlob(exportFileName(title, "svg"), new Blob([svg], { type: "image/svg+xml" }));
    return;
  }
  const scale = Math.min(PNG_SCALE, MAX_CANVAS_SIDE / Math.max(width, height), Math.sqrt(MAX_CANVAS_AREA / (width * height)));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No PNG");
  downloadBlob(exportFileName(title, "png"), blob);
}
