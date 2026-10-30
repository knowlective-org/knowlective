import { readFile } from "node:fs/promises";
import path from "node:path";

// The parts of pdf.js that the browser loads by URL rather than through the
// bundle (the PDF block, components/editor/pdf-block.tsx): the worker script,
// and the data it fetches on demand — CMaps (needed for most Japanese PDFs),
// the standard fonts, image decoders and a color profile. Served straight
// from the installed package, so they always match the bundled pdf.js.
//
//   /api/pdfjs/<version>/<file>   (<version> only keeps caches apart)
//
// Library files, the same for everyone: no sign-in needed.

const PACKAGE_DIR = path.join(process.cwd(), "node_modules", "pdfjs-dist");

// Only these files; nothing else in the package (or outside it) is reachable.
const ALLOWED = /^(?:build\/pdf\.worker\.min\.mjs|cmaps\/[\w-]+\.bcmap|standard_fonts\/[\w-]+\.(?:pfb|ttf)|wasm\/[\w-]+\.(?:wasm|js)|iccs\/[\w-]+\.icc)$/;

const CONTENT_TYPES: Record<string, string> = {
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

// auth: public — pdf.js's own files from the installed package; no user data.
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const file = (await params).path.slice(1).join("/");
  if (!ALLOWED.test(file)) return new Response(null, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(PACKAGE_DIR, file));
  } catch {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      // The version is in the URL.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
