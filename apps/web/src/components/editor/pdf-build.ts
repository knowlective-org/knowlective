import {
  PDFExporter,
  loadDefaultBodyFonts,
  strLit,
  typstDefaultSchemaMappings,
} from "@blocknote/xl-pdf-exporter";
import type { ExportBlock } from "./markdown-export";

// Building a page's PDF: BlockNote's exporter turns the blocks into Typst
// markup and compiles it with the Typst engine (WebAssembly). Nothing here
// touches the DOM or the network: the caller supplies the engine, the fonts
// and how to load files, so the same code runs in the browser and in tests.

// Font family names, as written inside the font files. The exporter's default
// fonts (loadDefaultBodyFonts) are Inter under this name; Noto Sans JP comes
// after it, for the characters Inter doesn't have.
const DEFAULT_FONT_FAMILY = "Inter 18pt";
const JAPANESE_FONT_FAMILY = "Noto Sans JP";

// Width of the text area: A4 (595pt) minus the exporter's default 48pt margins.
const CONTENT_WIDTH_PT = 499;
const PX_TO_PT = 0.75;

export type PdfBuildOptions = {
  title: string;
  // The Typst compiler: a URL to its .wasm file, or the file's bytes.
  wasm: string | URL | Uint8Array;
  // Noto Sans JP (regular and bold), as TTF bytes.
  japaneseFonts: Promise<Uint8Array[]>;
  // The bytes of an image in the page, in a format Typst reads (PNG, JPEG,
  // GIF, SVG). Rejects if the image can't be loaded.
  loadImage: (url: string) => Promise<Blob>;
  // A Mermaid diagram as a PNG, or null if it can't be drawn.
  drawMermaid: (code: string) => Promise<{ png: Uint8Array; widthPx: number } | null>;
  // The document's language ("ja" / "en"), and the alt text of a diagram in it.
  lang: string;
  mermaidAlt: string;
};

type MappingArgs = [block: ExportBlock, exporter: PdfExporter, ...rest: unknown[]];
type Mapping = (...args: MappingArgs) => string | Promise<string>;
// The exporter's types are tied to the editor's schema; this file only deals
// in the standard blocks' shapes (markdown-export.ts) plus `mermaid`.
type PdfExporter = PDFExporter<never, never, never>;

// `blocks`: the page's blocks after prepareBlocksForExport(…, { mermaid: "keep" }).
export async function buildPdf(schema: unknown, blocks: ExportBlock[], options: PdfBuildOptions): Promise<Blob> {
  const defaults = typstDefaultSchemaMappings;
  const defaultImage = defaults.blockMapping.image as unknown as Mapping;

  const blockMapping: Record<string, Mapping> = {
    ...(defaults.blockMapping as unknown as Record<string, Mapping>),

    // An image that can't be loaded (an external URL that refuses, a deleted
    // file) becomes a link instead of failing the whole export.
    image: async (block, exporter, ...rest) => {
      try {
        return await defaultImage(block, exporter, ...rest);
      } catch {
        const url = String(block.props?.url ?? "");
        const label = String(block.props?.name || block.props?.caption || url);
        return url ? `#link(${strLit(url)})[#${strLit(label)}]` : "";
      }
    },

    // Mermaid diagram: the drawn diagram; its source if it can't be drawn.
    mermaid: async (block, exporter) => {
      const code = String(block.props?.code ?? "").trim();
      if (!code) return "";
      const drawn = await options.drawMermaid(code).catch(() => null);
      if (!drawn) return `#raw(${strLit(code)}, block: true, lang: "mermaid")`;
      const path = exporter.registerImageBytes(`mermaid:${code}`, drawn.png);
      const width = Math.min(drawn.widthPx * PX_TO_PT, CONTENT_WIDTH_PT).toFixed(1);
      return `#figure(image(${strLit(path)}, width: ${width}pt), alt: ${strLit(options.mermaidAlt)})`;
    },
  };

  const exporter = new PDFExporter(
    schema as never,
    { ...defaults, blockMapping } as never,
    {
      fontFamily: [DEFAULT_FONT_FAMILY, JAPANESE_FONT_FAMILY],
      fonts: Promise.all([loadDefaultBodyFonts(), options.japaneseFonts]).then((sets) => sets.flat()),
      wasm: options.wasm,
      resolveFileUrl: options.loadImage,
    },
  );

  // The page title is the document's one H1, as on screen.
  const titleBlock: ExportBlock = {
    type: "heading",
    props: { level: 1 },
    content: [{ type: "text", text: options.title, styles: {} }],
    children: [],
  };
  const result = await exporter.toPDF([titleBlock, ...blocks] as never[], { title: options.title, lang: options.lang });
  if (result.error) {
    throw new Error(result.compileErrors.map((e) => e.message).join("\n") || "PDF compile failed");
  }
  return result.blob;
}
