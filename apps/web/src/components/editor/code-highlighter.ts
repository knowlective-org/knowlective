import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

// The Shiki highlighter for code blocks: @blocknote/code-block's languages
// plus ours (code-languages.ts: Perl). The highlighter is asked for a block's
// language by its id (the keys of the supported languages, code-languages.ts), so
// one grammar per id; aliases (```py) are resolved when the block is made.
// Each grammar is loaded the first time a block in that language is shown.

type Options = Parameters<typeof createBundledHighlighter<string, string>>[0];

const languages: Options["langs"] = {
  c: () => import("@shikijs/langs-precompiled/c"),
  cpp: () => import("@shikijs/langs-precompiled/cpp"),
  css: () => import("@shikijs/langs-precompiled/css"),
  glsl: () => import("@shikijs/langs-precompiled/glsl"),
  graphql: () => import("@shikijs/langs-precompiled/graphql"),
  haml: () => import("@shikijs/langs-precompiled/haml"),
  html: () => import("@shikijs/langs-precompiled/html"),
  java: () => import("@shikijs/langs-precompiled/java"),
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  json: () => import("@shikijs/langs-precompiled/json"),
  jsonc: () => import("@shikijs/langs-precompiled/jsonc"),
  jsonl: () => import("@shikijs/langs-precompiled/jsonl"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  julia: () => import("@shikijs/langs-precompiled/julia"),
  less: () => import("@shikijs/langs-precompiled/less"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  mdx: () => import("@shikijs/langs-precompiled/mdx"),
  php: () => import("@shikijs/langs-precompiled/php"),
  postcss: () => import("@shikijs/langs-precompiled/postcss"),
  pug: () => import("@shikijs/langs-precompiled/pug"),
  python: () => import("@shikijs/langs-precompiled/python"),
  r: () => import("@shikijs/langs-precompiled/r"),
  regexp: () => import("@shikijs/langs-precompiled/regexp"),
  sass: () => import("@shikijs/langs-precompiled/sass"),
  scss: () => import("@shikijs/langs-precompiled/scss"),
  shellscript: () => import("@shikijs/langs-precompiled/shellscript"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  svelte: () => import("@shikijs/langs-precompiled/svelte"),
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  vue: () => import("@shikijs/langs-precompiled/vue"),
  "vue-html": () => import("@shikijs/langs-precompiled/vue-html"),
  wasm: () => import("@shikijs/langs-precompiled/wasm"),
  wgsl: () => import("@shikijs/langs-precompiled/wgsl"),
  xml: () => import("@shikijs/langs-precompiled/xml"),
  yaml: () => import("@shikijs/langs-precompiled/yaml"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  haskell: () => import("@shikijs/langs-precompiled/haskell"),
  csharp: () => import("@shikijs/langs-precompiled/csharp"),
  latex: () => import("@shikijs/langs-precompiled/latex"),
  lua: () => import("@shikijs/langs-precompiled/lua"),
  mermaid: () => import("@shikijs/langs-precompiled/mermaid"),
  ruby: () => import("@shikijs/langs-precompiled/ruby"),
  rust: () => import("@shikijs/langs-precompiled/rust"),
  scala: () => import("@shikijs/langs-precompiled/scala"),
  swift: () => import("@shikijs/langs-precompiled/swift"),
  kotlin: () => import("@shikijs/langs-precompiled/kotlin"),
  "objective-c": () => import("@shikijs/langs-precompiled/objective-c"),
  // Ours (code-languages.ts).
  perl: () => import("@shikijs/langs-precompiled/perl"),
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
