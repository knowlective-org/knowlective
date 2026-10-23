import { type ExportBlock, prepareBlocksForExport } from "../src/components/editor/markdown-export";
import { type ImportedBlock, mermaidFromCodeBlock } from "../src/components/editor/markdown-import";
import { registerMarkdownBridge } from "../src/lib/markdown-bridge";

// Markdown ↔ page documents for the public API (src/lib/api/), through the
// bridge in src/lib/markdown-bridge.ts. Headings map one to one ("## " is the
// page's H2), so what the API returns can be sent back unchanged. The title
// is separate (the page's one H1): a "# " in the body becomes an H2, as in
// the editor; ```mermaid becomes a diagram, as when a file is expanded.

// BlockNote (with jsdom) is loaded on the first conversion, not at startup:
// it's large, and only the API uses it.
let engine: Promise<typeof import("./markdown-engine.mjs")> | null = null;
const load = () => (engine ??= import("./markdown-engine.mjs"));

function adjustImported(blocks: ImportedBlock[]): ImportedBlock[] {
  return blocks.map((block) => {
    const diagram = mermaidFromCodeBlock(block);
    if (diagram) return diagram;
    const children = block.children ? adjustImported(block.children) : block.children;
    if (block.type === "heading" && Number(block.props?.level ?? 1) < 2) {
      return { ...block, props: { ...block.props, level: 2 }, children };
    }
    return { ...block, children };
  });
}

export function startMarkdownBridge() {
  registerMarkdownBridge({
    async markdownToBody(markdown) {
      const e = await load();
      const blocks = adjustImported((await e.parseMarkdown(markdown)) as ImportedBlock[]);
      // A page always has a block.
      return e.blocksToUpdate(blocks.length > 0 ? blocks : [{ type: "paragraph" }]);
    },
    // knowlective's own blocks become standard Markdown, as in the editor's
    // export: diagrams as ```mermaid, child page blocks as links to the child
    // pages the reader can see, attachments as absolute links.
    async bodyToMarkdown(state, options) {
      const e = await load();
      const blocks = e.stateToBlocks(state) as ExportBlock[];
      return e.blocksToMarkdown(prepareBlocksForExport(blocks, { ...options, mermaid: "code" }));
    },
  });
}
