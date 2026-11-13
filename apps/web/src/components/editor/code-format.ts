import type { Plugin } from "prettier";
import { type IndentUnit, reindent } from "@/lib/reindent";
import { withBasePath } from "@/lib/base-path";

// The code block's "Format": Prettier (in the browser) for the web languages
// it knows and PHP, XML and Pug (its plugins), sql-formatter for SQL, and
// formatters compiled to WebAssembly for the C family (clang-format: C, C++,
// Java, C#, Objective-C), Python (Ruff), shell scripts (shfmt) and Lua
// (StyLua), all with the chosen indent. They lay out code written on one line
// (minified) too. Other languages only have their indentation changed to it
// (lib/reindent.ts). The formatters load the first time they're used.

type Prettier = { parser: string; plugins: () => Promise<unknown[]>; options?: Record<string, unknown> };

const estree = () => import("prettier/plugins/estree");
const babel = async () => [await import("prettier/plugins/babel"), await estree()];
const typescript = async () => [await import("prettier/plugins/typescript"), await estree()];
const postcss = async () => [await import("prettier/plugins/postcss")];
const html = async () => [await import("prettier/plugins/html"), ...(await babel()), await import("prettier/plugins/postcss")];
const markdown = async () => [await import("prettier/plugins/markdown")];

// Code block languages (their ids, code-languages.ts) Prettier formats.
const PRETTIER: Record<string, Prettier> = {
  javascript: { parser: "babel", plugins: babel },
  jsx: { parser: "babel", plugins: babel },
  typescript: { parser: "typescript", plugins: typescript },
  tsx: { parser: "typescript", plugins: typescript },
  json: { parser: "json", plugins: babel },
  jsonc: { parser: "jsonc", plugins: babel },
  css: { parser: "css", plugins: postcss },
  postcss: { parser: "css", plugins: postcss },
  scss: { parser: "scss", plugins: postcss },
  less: { parser: "less", plugins: postcss },
  html: { parser: "html", plugins: html },
  vue: { parser: "vue", plugins: html },
  markdown: { parser: "markdown", plugins: markdown },
  mdx: { parser: "mdx", plugins: markdown },
  yaml: { parser: "yaml", plugins: async () => [await import("prettier/plugins/yaml")] },
  graphql: { parser: "graphql", plugins: async () => [await import("prettier/plugins/graphql")] },
};

// Prettier's plugins for more languages (not bundled with it).
// The PHP version is set: "auto" would look for a composer.json on disk (not
// in a browser: next.config.ts gives it an empty fs).
PRETTIER.php = { parser: "php", plugins: async () => [await import("@prettier/plugin-php/standalone")], options: { phpVersion: "8.5" } };
// Whitespace between tags isn't kept as it was, or code on one line would stay so.
// (Its plugin is the module's default export, not its named ones.)
PRETTIER.xml = {
  parser: "xml",
  plugins: async () => [(await import("@prettier/plugin-xml")).default],
  options: { xmlWhitespaceSensitivity: "ignore" },
};
PRETTIER.pug = { parser: "pug", plugins: async () => [await import("@prettier/plugin-pug")] };

// Formatters compiled to WebAssembly (@wasm-fmt), each loaded once, its
// .wasm from /api/code-format (served from the installed package).
type Format = (code: string, unit: IndentUnit) => string;
type WasmModule = { default: (input: string) => Promise<unknown> };
const loaded = new Map<string, Promise<unknown>>();
async function wasm<M extends WasmModule>(file: string, load: () => Promise<M>): Promise<M> {
  const formatter = await load();
  if (!loaded.has(file)) {
    const ready = formatter.default(withBasePath(`/api/code-format/${file}`));
    // A failed download can be tried again.
    ready.catch(() => loaded.delete(file));
    loaded.set(file, ready);
  }
  await loaded.get(file);
  return formatter;
}
const width = (unit: IndentUnit) => (unit === "tab" ? 4 : Number(unit));

// clang-format: the C family, with the language from the file name. Google's
// style with the chosen indent; the line width is wider than its 80.
const clang =
  (filename: string) =>
  async (): Promise<Format> => {
    const { format } = await wasm("clang-format.wasm", () => import("@wasm-fmt/clang-format/web"));
    return (code, unit) =>
      format(
        code,
        filename,
        JSON.stringify({
          BasedOnStyle: "Google",
          IndentWidth: width(unit),
          TabWidth: width(unit),
          UseTab: unit === "tab" ? "ForIndentation" : "Never",
          ColumnLimit: 100,
        }),
      );
  };

const WASM: Record<string, () => Promise<Format>> = {
  c: clang("main.c"),
  cpp: clang("main.cpp"),
  java: clang("main.java"),
  csharp: clang("main.cs"),
  "objective-c": clang("main.m"),
  python: async () => {
    const { format } = await wasm("ruff_fmt.wasm", () => import("@wasm-fmt/ruff_fmt/web"));
    return (code, unit) => format(code, "main.py", { indent_style: unit === "tab" ? "tab" : "space", indent_width: width(unit) });
  },
  shellscript: async () => {
    const { format } = await wasm("shfmt.wasm", () => import("@wasm-fmt/shfmt/web"));
    // 0: tabs.
    return (code, unit) => format(code, "main.sh", { indent: unit === "tab" ? 0 : width(unit) });
  },
  lua: async () => {
    const { format } = await wasm("lua_fmt.wasm", () => import("@wasm-fmt/lua_fmt/web"));
    return (code, unit) => format(code, { indent_style: unit === "tab" ? "tab" : "space", indent_width: width(unit) });
  },
};

// Whether "Format" does more than change the indentation (it also lays out
// code written on one line, minified).
export function hasFormatter(language: string): boolean {
  return language in PRETTIER || language in WASM || language === "sql";
}

// Throws when the code can't be parsed in its language.
export async function formatCode(code: string, language: string, unit: IndentUnit): Promise<string> {
  const indent = { tabWidth: unit === "tab" ? 4 : Number(unit), useTabs: unit === "tab" };
  const prettier = PRETTIER[language];
  if (prettier) {
    const { format } = await import("prettier/standalone");
    const plugins = (await prettier.plugins()) as Plugin[];
    // Prettier ends with a newline; the block shouldn't get an empty last line.
    return (await format(code, { parser: prettier.parser, plugins, ...indent, ...prettier.options })).replace(/\n+$/, "");
  }
  if (language === "sql") {
    const { format } = await import("sql-formatter");
    return format(code, indent);
  }
  const formatter = WASM[language];
  if (formatter) return (await formatter())(code, unit).replace(/\n+$/, "");
  return reindent(code, unit);
}
