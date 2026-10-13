import type { ExportBlock } from "./markdown-export";
import { loadMermaid } from "./mermaid-block";
import { buildPdf } from "./pdf-build";

// The browser side of the PDF export: where the compiler and fonts come from,
// how images are loaded and how Mermaid diagrams are drawn. Imported only
// when someone exports (it pulls in the exporter), never with the editor.

const asset = (name: string) => `/api/export-assets/${name}`;

// Formats the Typst compiler reads as they are.
const TYPST_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];

// Drawn at twice the size, so diagrams stay sharp on paper.
const MERMAID_SCALE = 2;

// Kept for the page's lifetime: the fonts are large, and the compiler reuses
// its font set when it's handed the same byte arrays again.
let japaneseFonts: Promise<Uint8Array[]> | undefined;

function loadJapaneseFonts(): Promise<Uint8Array[]> {
  japaneseFonts ??= Promise.all(
    ["NotoSansJP-Regular.ttf", "NotoSansJP-Bold.ttf"].map(async (name) => {
      const res = await fetch(asset(name));
      if (!res.ok) throw new Error(`font ${name}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  );
  // A failed download is tried again on the next export.
  japaneseFonts.catch(() => {
    japaneseFonts = undefined;
  });
  return japaneseFonts;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob failed"))), "image/png"),
  );
}

// Attachments come with the viewer's session; WebP, AVIF and the like are
// redrawn as PNG.
async function loadImage(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image ${res.status}`);
  const blob = await res.blob();
  if (TYPST_IMAGE_TYPES.includes(blob.type)) return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvasToPng(canvas);
}

let mermaidRenders = 0;

// Draws the diagram again for the export, with its labels as SVG text: the
// on-screen version puts HTML inside the SVG, which a canvas refuses to give
// back as an image.
async function drawMermaid(code: string): Promise<{ png: Uint8Array; widthPx: number } | null> {
  const id = `mermaid-export-${++mermaidRenders}`;
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(
      id,
      `%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%\n${code}`,
    );
    const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    const [, , width, height] = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    if (!(width > 0 && height > 0)) return null;
    // Mermaid sizes the SVG to its container; an image needs real numbers.
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    root.removeAttribute("style");

    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * MERMAID_SCALE);
    canvas.height = Math.ceil(height * MERMAID_SCALE);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await canvasToPng(canvas);
    return { png: new Uint8Array(await png.arrayBuffer()), widthPx: width };
  } catch {
    // Mermaid can leave its work element behind when drawing fails.
    document.getElementById(`d${id}`)?.remove();
    return null;
  }
}

// `blocks`: after prepareBlocksForExport(…, { mermaid: "keep" }).
export function exportPdf(schema: unknown, blocks: ExportBlock[], title: string): Promise<Blob> {
  return buildPdf(schema, blocks, {
    title,
    wasm: asset("typst.wasm"),
    japaneseFonts: loadJapaneseFonts(),
    loadImage,
    drawMermaid,
  });
}
