"use client";

import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { childPagesBlock } from "./child-pages-block";
import { childTableBlock } from "./child-table-block";
import { linkPreviewBlock } from "./link-preview-block";
import { mermaidBlock } from "./mermaid-block";
import { pdfBlock } from "./pdf-block";
import { videoEmbedBlock } from "./video-embed-block";

// The editor's block types: BlockNote's defaults plus yosuga's own. Block
// types are saved in page documents, so a custom type must never be removed
// or renamed once released — pages using it would no longer load.
//
// Headings start at H2: the page title is the page's one H1. Without level 1
// in the schema it isn't offered (slash menu, toolbar, "# ", Ctrl+Alt+1);
// H1s that still arrive (pasted HTML, older pages) are turned into H2 by the
// editor (demoteH1 in collaborative-editor.tsx).
export const HEADING_LEVELS = [2, 3, 4, 5, 6] as const;

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    heading: createHeadingBlockSpec({ levels: HEADING_LEVELS, defaultLevel: 2 }),
    childPages: childPagesBlock(),
    childTable: childTableBlock(),
    mermaid: mermaidBlock(),
    pdf: pdfBlock(),
    linkPreview: linkPreviewBlock(),
    videoEmbed: videoEmbedBlock(),
  },
});

export type YosugaEditor = typeof editorSchema.BlockNoteEditor;

export function customSlashMenuItems(editor: YosugaEditor): DefaultReactSuggestionItem[] {
  const group = "ページ";
  return [
    {
      title: "子ページ一覧",
      subtext: "このページの子ページへのリンクを常に最新で表示",
      aliases: ["child", "children", "subpage", "pages", "list", "kopeji", "子ページ", "一覧"],
      group,
      icon: <span aria-hidden>📑</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "childPages" }),
    },
    {
      title: "子ページテーブル",
      subtext: "子ページを行にした表。担当者などの列を追加できます",
      aliases: ["child", "children", "subpage", "pages", "table", "kopeji", "子ページ", "テーブル"],
      group,
      icon: <span aria-hidden>📊</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "childTable" }),
    },
    {
      title: "Mermaid 図",
      subtext: "Mermaid の記法からフローチャートなどの図を描く",
      aliases: ["mermaid", "diagram", "flowchart", "chart", "zu", "図", "フローチャート", "マーメイド"],
      group: "図",
      icon: <span aria-hidden>🧜</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "mermaid" }),
    },
  ];
}
