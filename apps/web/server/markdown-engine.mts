// BlockNote's server editor for the public API's Markdown conversion
// (page-markdown.ts loads this). An ES module (.mts) on purpose: apps/web is a
// CommonJS package, and under require() Node gets BlockNote's CommonJS build,
// which fails to load ("….default.extend is not a function").
import {
  BlockNoteSchema,
  createBlockSpec,
  createBlockSpecFromTiptapNode,
  createCodeBlock,
  createCodeBlockConfig,
  createPreCode,
  parsePreCode,
  parsePreCodeContent,
  createHeadingBlockSpec,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { Node } from "@tiptap/core";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import * as Y from "yjs";
import { BLOCK_CONFIGS, CODE_BLOCK_EXTRA_PROPS, HEADING_LEVELS, INLINE_CONFIGS } from "../src/components/editor/block-configs";
import { codeBlockOptions } from "@blocknote/code-block";
import { withOurLanguages } from "../src/components/editor/code-languages";
import { GRID_TABLE_NODES, GRID_TABLE_PROPS } from "../src/components/editor/grid-table-config";

// The editor's schema (components/editor/schema.tsx) without React: the same
// block types and props. knowlective's own blocks render as an empty element,
// which only matters for HTML output — they're turned into standard blocks
// before Markdown is written (prepareBlocksForExport).
const plain = { render: () => ({ dom: document.createElement("div") }) };
// The same for blocks holding text.
const withText = {
  render: () => {
    const dom = document.createElement("div");
    return { dom, contentDOM: dom };
  },
};

// The editor's code block (components/editor/code-block.ts): BlockNote's,
// with the editor's languages and our props (the preview).
const codeOptions = withOurLanguages(codeBlockOptions);
const codeConfig = createCodeBlockConfig(codeOptions);
const codeBlock = createBlockSpec(
  { ...codeConfig, propSchema: { ...codeConfig.propSchema, ...CODE_BLOCK_EXTRA_PROPS } },
  {
    // As createCodeBlockSpec's.
    meta: { code: true, defining: true, isolating: false, highlight: (block) => block.props.language },
    parse: (el) => parsePreCode(el),
    parseContent: (opts) => parsePreCodeContent(opts, "codeBlock"),
    render: (block, editor) => createCodeBlock(block, editor),
    toExternalHTML: (block) => createPreCode(block),
  },
)();

// The extended table's nodes, without the editor's controls.
type NodeConfig = Parameters<typeof Node.create>[0];
const gridSpec = (type: keyof typeof GRID_TABLE_NODES, props = {}) =>
  createBlockSpecFromTiptapNode({ node: Node.create(GRID_TABLE_NODES[type] as NodeConfig), type, content: "none" }, props);

const serverSchema = withMultiColumn(BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    heading: createHeadingBlockSpec({ levels: HEADING_LEVELS, defaultLevel: 2 }),
    codeBlock,
    childPages: createBlockSpec(BLOCK_CONFIGS.childPages, plain)(),
    childTable: createBlockSpec(BLOCK_CONFIGS.childTable, plain)(),
    childBoard: createBlockSpec(BLOCK_CONFIGS.childBoard, plain)(),
    mermaid: createBlockSpec(BLOCK_CONFIGS.mermaid, plain)(),
    pdf: createBlockSpec(BLOCK_CONFIGS.pdf, plain)(),
    linkPreview: createBlockSpec(BLOCK_CONFIGS.linkPreview, plain)(),
    videoEmbed: createBlockSpec(BLOCK_CONFIGS.videoEmbed, plain)(),
    maskedText: createBlockSpec(BLOCK_CONFIGS.maskedText, plain)(),
    chat: createBlockSpec(BLOCK_CONFIGS.chat, plain)(),
    todo: createBlockSpec(BLOCK_CONFIGS.todo, withText)(),
    gridTable: gridSpec("gridTable", GRID_TABLE_PROPS),
    gridRow: gridSpec("gridRow"),
    gridCell: gridSpec("gridCell"),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    // Turned into "@name" text before Markdown is written (prepareBlocksForExport).
    mention: createInlineContentSpec(INLINE_CONFIGS.mention, { render: () => ({ dom: document.createElement("span") }) }),
  },
}));

const newEditor = () => ServerBlockNoteEditor.create({ schema: serverSchema });

// Yjs documents are made and read only here: this module's Yjs (ES module)
// is the one BlockNote's y-prosemirror checks against; one from the CommonJS
// side ("Yjs was already imported") wouldn't pass. Bytes and plain blocks cross.

export const parseMarkdown = (markdown: string): Promise<unknown[]> => newEditor().tryParseMarkdownToBlocks(markdown);

// The blocks as a Yjs update of a document holding only the BlockNote fragment.
export function blocksToUpdate(blocks: unknown[]): Uint8Array {
  return Y.encodeStateAsUpdate(newEditor().blocksToYDoc(blocks as never, "blocknote"));
}

export function stateToBlocks(state: Uint8Array): unknown[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return newEditor().yDocToBlocks(doc, "blocknote");
}

export const blocksToMarkdown = (blocks: unknown[]): Promise<string> => newEditor().blocksToMarkdownLossy(blocks as never);

// The document's node and mark types with their attributes, one per line
// (sorted): what an editor must know to keep a page's document intact
// (test/collab-version.test.mts ties it to src/lib/collab-version.ts).
export function schemaOutline(): string {
  const schema = newEditor().editor.pmSchema;
  const line = (kind: string, name: string, attrs: Record<string, unknown>) =>
    `${kind} ${name}(${Object.keys(attrs).sort().join(",")})`;
  return [
    ...Object.values(schema.nodes).map((n) => line("node", n.name, n.spec.attrs ?? {})),
    ...Object.values(schema.marks).map((m) => line("mark", m.name, m.spec.attrs ?? {})),
  ]
    .sort()
    .join("\n");
}
