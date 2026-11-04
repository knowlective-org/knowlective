// The languages a code block can be set to: @blocknote/code-block's
// (codeBlockOptions), plus ones it doesn't have (each needs its grammar in
// code-highlighter.ts). Used by the editor (code-block.ts) and the server's
// schema (server/markdown-engine.mts), so ```perl gets its language both ways.
// New blocks start as plain text. Languages can be added, but not removed or
// renamed: blocks keep the id.
//
// Dependency-free: the server's engine is an ES module and imports
// @blocknote/code-block itself (through this CommonJS package it would load
// BlockNote's CommonJS build, which doesn't work).

type CodeBlockOptions = {
  defaultLanguage?: string;
  supportedLanguages?: Record<string, { name: string; aliases?: string[] }>;
};

export const EXTRA_CODE_LANGUAGES = {
  perl: { name: "Perl", aliases: ["perl", "pl"] },
};

export function withOurLanguages<T extends CodeBlockOptions>(options: T) {
  return {
    ...options,
    defaultLanguage: "text",
    supportedLanguages: { ...options.supportedLanguages, ...EXTRA_CODE_LANGUAGES },
  };
}
