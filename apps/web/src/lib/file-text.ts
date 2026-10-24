import JSZip from "jszip";

// The text of an attached file, for search (lib/file-search.ts). Text files,
// PDF, Word, Excel and PowerPoint; anything else (images, archives, …) has
// none. Never throws: a file that can't be read simply isn't searchable by
// its content.

// Kept per file, so one huge file can't dominate a page's index.
export const MAX_FILE_TEXT_CHARS = 200_000;
// Larger files aren't read for text (they're held in memory to be read).
export const MAX_EXTRACT_BYTES = 50 * 1024 * 1024;

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|ini|toml|html?|css|js|ts|py|rb|go|java|sql|sh)$/i;

const decodeText = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

// XML text content without tags or entities (Office files).
function xmlText(xml: string, tag: RegExp): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(tag)) parts.push(m[1]);
  return parts
    .join(" ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Text only: no fonts are drawn, so pdf.js's font warnings are silenced.
  // A plain Uint8Array: pdf.js refuses a Node Buffer (what storage reads give).
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    let length = 0;
    for (let i = 1; i <= doc.numPages && length < MAX_FILE_TEXT_CHARS; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pages.push(text);
      length += text.length;
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
}

async function xlsxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const parts: string[] = [];
  const shared = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (shared) parts.push(xmlText(shared, /<t[^>]*>([^<]*)<\/t>/g));
  // Text typed straight into cells (inline strings), sheet by sheet.
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()) {
    parts.push(xmlText(await zip.file(name)!.async("string"), /<is>\s*<t[^>]*>([^<]*)<\/t>/g));
  }
  return parts.join("\n");
}

async function pptxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const slide = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n))
    .sort((a, b) => slide(a) - slide(b));
  const parts: string[] = [];
  for (const name of names) parts.push(xmlText(await zip.file(name)!.async("string"), /<a:t>([^<]*)<\/a:t>/g));
  return parts.join("\n");
}

export async function extractFileText(name: string, mimeType: string, bytes: Uint8Array): Promise<string | null> {
  if (bytes.byteLength > MAX_EXTRACT_BYTES) return null;
  try {
    let text: string | null = null;
    if (/\.pdf$/i.test(name) || mimeType === "application/pdf") text = await pdfText(bytes);
    else if (/\.docx$/i.test(name)) text = await docxText(bytes);
    else if (/\.xlsx$/i.test(name)) text = await xlsxText(bytes);
    else if (/\.pptx$/i.test(name)) text = await pptxText(bytes);
    else if (TEXT_EXTENSIONS.test(name) || mimeType.startsWith("text/")) {
      text = decodeText(bytes);
      if (/\.html?$/i.test(name)) text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
    }
    if (!text) return null;
    const compact = text.replace(/[ \t　]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    return compact ? compact.slice(0, MAX_FILE_TEXT_CHARS) : null;
  } catch (err) {
    console.error("[search] reading an attachment's text failed", err);
    return null;
  }
}
