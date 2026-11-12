import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

// The Shiki highlighter for code blocks: @blocknote/code-block's languages
// plus ours (code-languages.ts: Perl). The highlighter is asked for a block's
// language by its id (the keys of the supported languages, code-languages.ts), so
// one grammar per id; aliases (```py) are resolved when the block is made.
// Each grammar is loaded the first time a block in that language is shown.
// The grammars as written (@shikijs/langs), not precompiled: precompiling
// turns the anchor `\G` into an empty pattern, so in HTML a <style> or
// <script> start tag never ended and the rest of the code came out "invalid"
// (test/code-highlighter.test.mts).

type Options = Parameters<typeof createBundledHighlighter<string, string>>[0];

const languages: Options["langs"] = {
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  css: () => import("@shikijs/langs/css"),
  glsl: () => import("@shikijs/langs/glsl"),
  graphql: () => import("@shikijs/langs/graphql"),
  haml: () => import("@shikijs/langs/haml"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsonl: () => import("@shikijs/langs/jsonl"),
  jsx: () => import("@shikijs/langs/jsx"),
  julia: () => import("@shikijs/langs/julia"),
  less: () => import("@shikijs/langs/less"),
  markdown: () => import("@shikijs/langs/markdown"),
  mdx: () => import("@shikijs/langs/mdx"),
  php: () => import("@shikijs/langs/php"),
  postcss: () => import("@shikijs/langs/postcss"),
  pug: () => import("@shikijs/langs/pug"),
  python: () => import("@shikijs/langs/python"),
  r: () => import("@shikijs/langs/r"),
  regexp: () => import("@shikijs/langs/regexp"),
  sass: () => import("@shikijs/langs/sass"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  "vue-html": () => import("@shikijs/langs/vue-html"),
  wasm: () => import("@shikijs/langs/wasm"),
  wgsl: () => import("@shikijs/langs/wgsl"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  tsx: () => import("@shikijs/langs/tsx"),
  haskell: () => import("@shikijs/langs/haskell"),
  csharp: () => import("@shikijs/langs/csharp"),
  latex: () => import("@shikijs/langs/latex"),
  lua: () => import("@shikijs/langs/lua"),
  mermaid: () => import("@shikijs/langs/mermaid"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
  // Ours (code-languages.ts).
  perl: () => import("@shikijs/langs/perl"),
};

const themes: Options["themes"] = {
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
};

const create = createBundledHighlighter({
  langs: languages,
  themes,
  engine: () => createJavaScriptRegexEngine(),
});

// The dark theme is what code blocks show (BlockNote's code block is dark);
// the light one is for its source popups.
export const createCodeHighlighter = () => create({ themes: ["github-dark", "github-light"], langs: [] });
