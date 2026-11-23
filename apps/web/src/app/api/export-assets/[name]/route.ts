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
  // For what Noto Sans JP doesn't have, in a presentation's PDF.
  "NotoSansKR-Regular.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/400Regular/NotoSansKR_400Regular.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-Bold.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/700Bold/NotoSansKR_700Bold.ttf",
    type: "font/ttf",
  },
  // The other weights a box's text can have.
  "NotoSansJP-Thin.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/100Thin/NotoSansJP_100Thin.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-Thin.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/100Thin/NotoSansKR_100Thin.ttf",
    type: "font/ttf",
  },
  "NotoSansJP-ExtraLight.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/200ExtraLight/NotoSansJP_200ExtraLight.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-ExtraLight.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/200ExtraLight/NotoSansKR_200ExtraLight.ttf",
    type: "font/ttf",
  },
  "NotoSansJP-Light.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/300Light/NotoSansJP_300Light.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-Light.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/300Light/NotoSansKR_300Light.ttf",
    type: "font/ttf",
  },
  "NotoSansJP-Medium.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/500Medium/NotoSansJP_500Medium.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-Medium.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/500Medium/NotoSansKR_500Medium.ttf",
    type: "font/ttf",
  },
  "NotoSansJP-SemiBold.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/600SemiBold/NotoSansJP_600SemiBold.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-SemiBold.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/600SemiBold/NotoSansKR_600SemiBold.ttf",
    type: "font/ttf",
  },
  "NotoSansJP-ExtraBold.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/800ExtraBold/NotoSansJP_800ExtraBold.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-ExtraBold.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/800ExtraBold/NotoSansKR_800ExtraBold.ttf",
    type: "font/ttf",
  },
  "NotoSansJP-Black.ttf": {
    file: "@expo-google-fonts/noto-sans-jp/900Black/NotoSansJP_900Black.ttf",
    type: "font/ttf",
  },
  "NotoSansKR-Black.ttf": {
    file: "@expo-google-fonts/noto-sans-kr/900Black/NotoSansKR_900Black.ttf",
    type: "font/ttf",
  },
  "NotoEmoji-Regular.ttf": {
    file: "@expo-google-fonts/noto-emoji/400Regular/NotoEmoji_400Regular.ttf",
    type: "font/ttf",
  },
};

// auth: public — files from installed packages (Typst compiler, fonts); no user data.
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
