import type { Plugin } from "prettier";
import { type IndentUnit, reindent } from "@/lib/reindent";

// The code block's "Format": Prettier (in the browser) for the web languages
// it knows, sql-formatter for SQL, both with the chosen indent. Other
// languages only have their indentation changed to it (lib/reindent.ts).
// The formatters load the first time they're used.

type Prettier = { parser: string; plugins: () => Promise<unknown[]> };

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

// Whether "Format" does more than change the indentation.
export function hasFormatter(language: string): boolean {
  return language in PRETTIER || language === "sql";
}

// Throws when the code can't be parsed in its language.
export async function formatCode(code: string, language: string, unit: IndentUnit): Promise<string> {
  const indent = { tabWidth: unit === "tab" ? 4 : Number(unit), useTabs: unit === "tab" };
  const prettier = PRETTIER[language];
  if (prettier) {
    const { format } = await import("prettier/standalone");
    const plugins = (await prettier.plugins()) as Plugin[];
    // Prettier ends with a newline; the block shouldn't get an empty last line.
    return (await format(code, { parser: prettier.parser, plugins, ...indent })).replace(/\n+$/, "");
  }
  if (language === "sql") {
    const { format } = await import("sql-formatter");
    return format(code, indent);
  }
  return reindent(code, unit);
}
