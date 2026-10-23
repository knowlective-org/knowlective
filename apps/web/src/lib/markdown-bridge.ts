// Converting between Markdown and page documents (the public API) runs in
// the custom server (server/page-markdown.ts): it needs BlockNote's server
// editor, whose React parts don't load in Next.js's server bundle (React
// there is the server-components build). The bundle reaches it through
// globalThis, like lib/collab-events.ts. Keep dependency-free.

import type { ChildPageItem } from "./page-property-types";

export type MarkdownExportOptions = {
  // Origin + base path, for absolute links to child pages and attachments.
  origin: string;
  pageId: string;
  // The pages below this one that the reader can see (child page blocks).
  childPages: ChildPageItem[];
  // Shown for a child page without a title.
  untitled: string;
};

type MarkdownBridge = {
  // The body as a Yjs update of a document holding only the BlockNote fragment.
  markdownToBody(markdown: string): Promise<Uint8Array>;
  // The body (BlockNote fragment) of a document's Yjs state, as Markdown.
  bodyToMarkdown(state: Uint8Array, options: MarkdownExportOptions): Promise<string>;
};

const BRIDGE_KEY = Symbol.for("knowlective.markdown");

export function registerMarkdownBridge(bridge: MarkdownBridge) {
  (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = bridge;
}

function bridge(): MarkdownBridge {
  const b = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as MarkdownBridge | undefined;
  if (!b) throw new Error("The Markdown converter isn't running (it's part of the custom server)");
  return b;
}

export const markdownToBody = (markdown: string) => bridge().markdownToBody(markdown);
export const bodyToMarkdown = (state: Uint8Array, options: MarkdownExportOptions) =>
  bridge().bodyToMarkdown(state, options);
