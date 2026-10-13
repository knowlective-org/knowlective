import { readFile } from "node:fs/promises";
import path from "node:path";

// What the browser needs to build a page's PDF (components/editor/
// pdf-export.ts) and can't get through the bundle: the Typst compiler
// (WebAssembly) and the Japanese fonts. Served from the installed packages.
// Library files, the same for everyone: no sign-in needed.

const MODULES = path.join(process.cwd(), "node_modules");

// Only these files.
const FILES: Record<string, { file: string; type: string }> = {
  "typst.wasm": {
    file: "@blocknote/xl-typst-compiler/pkg/blocknote_typst_wasm_bg.wasm",
    // Needed for the browser to compile it while it downloads.
    type: "application/wasm",
  },
  "NotoSansJP-Regular.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf",
    type: "font/ttf",
  },
  "NotoSansJP-Bold.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/700Bold/NotoSansJP_700Bold.ttf",
    type: "font/ttf",
  },
};

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const entry = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
  if (!entry) return new Response(null, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(MODULES, entry.file));
  } catch {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": entry.type,
      "X-Content-Type-Options": "nosniff",
      // Large (the compiler is ~26MB, each font ~6MB) and only changes with
      // an upgrade.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
