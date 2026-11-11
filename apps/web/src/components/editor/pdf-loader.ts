import { withBasePath } from "@/lib/base-path";

// pdf.js, for showing PDFs page by page (pdf-block.tsx) and reading their
// text (pdf-import.ts). It's large, so it's only downloaded when needed.

export type PdfJs = typeof import("pdfjs-dist");
export type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
let pdfjsLoading: Promise<PdfJs> | undefined;

// The worker and the data pdf.js fetches on demand come from /api/pdfjs.
export const pdfAssetUrl = (pdfjs: PdfJs, dir: string) => withBasePath(`/api/pdfjs/${pdfjs.version}/${dir}`);

export function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoading ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfAssetUrl(pdfjs, "build/pdf.worker.min.mjs");
    return pdfjs;
  });
  return pdfjsLoading;
}

// What getDocument() needs besides the file: where its data comes from, and
// nothing in the PDF run.
export function pdfOptions(pdfjs: PdfJs) {
  return {
    cMapUrl: pdfAssetUrl(pdfjs, "cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrl(pdfjs, "standard_fonts/"),
    wasmUrl: pdfAssetUrl(pdfjs, "wasm/"),
    iccUrl: pdfAssetUrl(pdfjs, "iccs/"),
    enableXfa: false,
  };
}
