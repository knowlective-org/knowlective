// BlockNote's server editor for the public API's Markdown conversion
// (page-markdown.ts loads this). An ES module (.mts) on purpose: apps/web is a
// CommonJS package, and under require() Node gets BlockNote's CommonJS build,
// which fails to load ("….default.extend is not a function").
import { BlockNoteSchema, createBlockSpec, createHeadingBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import * as Y from "yjs";
import { BLOCK_CONFIGS, HEADING_LEVELS } from "../src/components/editor/block-configs";

// The editor's schema (components/editor/schema.tsx) without React: the same
// block types and props. knowlective's own blocks render as an empty element,
// which only matters for HTML output — they're turned into standard blocks
// before Markdown is written (prepareBlocksForExport).
const plain = { render: () => ({ dom: document.createElement("div") }) };

const serverSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    heading: createHeadingBlockSpec({ levels: HEADING_LEVELS, defaultLevel: 2 }),
    childPages: createBlockSpec(BLOCK_CONFIGS.childPages, plain)(),
    childTable: createBlockSpec(BLOCK_CONFIGS.childTable, plain)(),
    childBoard: createBlockSpec(BLOCK_CONFIGS.childBoard, plain)(),
    mermaid: createBlockSpec(BLOCK_CONFIGS.mermaid, plain)(),
    pdf: createBlockSpec(BLOCK_CONFIGS.pdf, plain)(),
    linkPreview: createBlockSpec(BLOCK_CONFIGS.linkPreview, plain)(),
    videoEmbed: createBlockSpec(BLOCK_CONFIGS.videoEmbed, plain)(),
  },
});

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
