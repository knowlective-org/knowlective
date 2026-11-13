import { readFile } from "node:fs/promises";
import path from "node:path";

// The formatters the code block's "Format" runs in the browser as
// WebAssembly (components/editor/code-format.ts): clang-format, Ruff, shfmt
// and StyLua. Served from the installed packages, not bundled. Library files,
// the same for everyone: no sign-in needed.

const MODULES = path.join(process.cwd(), "node_modules");

// Only these files.
const FILES: Record<string, string> = {
  "clang-format.wasm": "@wasm-fmt/clang-format/clang-format.wasm",
  "ruff_fmt.wasm": "@wasm-fmt/ruff_fmt/ruff_fmt_bg.wasm",
  "shfmt.wasm": "@wasm-fmt/shfmt/shfmt.wasm",
  "lua_fmt.wasm": "@wasm-fmt/lua_fmt/lua_fmt_bg.wasm",
};

// auth: public — formatter WebAssembly from installed packages; no user data.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
  if (!file) return new Response(null, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(MODULES, file));
  } catch {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      // Needed for the browser to compile it while it downloads.
      "Content-Type": "application/wasm",
      "X-Content-Type-Options": "nosniff",
      // Only changes with an upgrade.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
