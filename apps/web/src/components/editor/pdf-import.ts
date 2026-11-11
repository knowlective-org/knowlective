import { loadPdfJs, pdfOptions } from "./pdf-loader";
import { type PdfBlock, type PdfPiece, pdfBlocks, pdfLines } from "./pdf-text";

// A PDF's text as blocks, read in the browser (the file isn't sent anywhere
// for this): pdf.js gives each page's pieces of text, pdf-text.ts puts them
// together. Up to MAX_PAGES pages.
export const MAX_PDF_IMPORT_PAGES = 300;

export class PdfPasswordError extends Error {}

export async function readPdfBlocks(file: File): Promise<{ blocks: PdfBlock[]; truncated: boolean }> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...pdfOptions(pdfjs) });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    if ((err as { name?: string })?.name === "PasswordException") throw new PdfPasswordError();
    throw err;
  }
  try {
    const count = Math.min(pdf.numPages, MAX_PDF_IMPORT_PAGES);
    const pages = [];
    for (let n = 1; n <= count; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const pieces: PdfPiece[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const [, , c, d, x, y] = item.transform as number[];
        pieces.push({ text: item.str, x, y, size: Math.hypot(c, d) || item.height, endOfLine: item.hasEOL });
      }
      pages.push(pdfLines(pieces));
      page.cleanup();
    }
    return { blocks: pdfBlocks(pages), truncated: pdf.numPages > count };
  } finally {
    void task.destroy();
  }
}
