"use client";

import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { Messages } from "@/i18n/messages/en";
import { childPagesBlock } from "./child-pages-block";
import { childBoardBlock } from "./child-board-block";
import { childTableBlock } from "./child-table-block";
import { linkPreviewBlock } from "./link-preview-block";
import { mermaidBlock } from "./mermaid-block";
import { pdfBlock } from "./pdf-block";
import { videoEmbedBlock } from "./video-embed-block";

// The editor's block types: BlockNote's defaults plus knowlective's own. Block
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
    childBoard: childBoardBlock(),
    mermaid: mermaidBlock(),
    pdf: pdfBlock(),
    linkPreview: linkPreviewBlock(),
    videoEmbed: videoEmbedBlock(),
  },
});

export type KnowlectiveEditor = typeof editorSchema.BlockNoteEditor;

type SlashKey = keyof Messages["editor"]["slash"];

// `t`: the viewer's translator (useTranslations()).
export function customSlashMenuItems(
  editor: KnowlectiveEditor,
  t: (key: `editor.slash.${SlashKey}`) => string,
): DefaultReactSuggestionItem[] {
  const group = t("editor.slash.group");
  // English words always match; the language's own come from its text.
  const aliases = (key: `${SlashKey & `${string}Aliases`}`, english: string[]) => [
    ...english,
    ...t(`editor.slash.${key}`).split(",").filter(Boolean),
  ];
  return [
    {
      title: t("editor.slash.childPages"),
      subtext: t("editor.slash.childPagesSub"),
      aliases: aliases("childPagesAliases", ["child", "children", "subpage", "pages", "list"]),
      group,
      icon: <span aria-hidden>📑</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "childPages" }),
    },
    {
      title: t("editor.slash.childTable"),
      subtext: t("editor.slash.childTableSub"),
      aliases: aliases("childTableAliases", ["child", "children", "subpage", "pages", "table"]),
      group,
      icon: <span aria-hidden>📊</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "childTable" }),
    },
    {
      title: t("editor.slash.childBoard"),
      subtext: t("editor.slash.childBoardSub"),
      aliases: aliases("childBoardAliases", ["kanban", "board", "child", "children", "subpage", "status", "kanban board"]),
      group,
      icon: <span aria-hidden>🗂️</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "childBoard" }),
    },
    {
      title: t("editor.slash.mermaid"),
      subtext: t("editor.slash.mermaidSub"),
      aliases: aliases("mermaidAliases", ["mermaid", "diagram", "flowchart", "chart"]),
      group: t("editor.slash.diagramGroup"),
      icon: <span aria-hidden>🧜</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "mermaid" }),
    },
  ];
}
