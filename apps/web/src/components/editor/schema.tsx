"use client";

import {
  BlockNoteSchema,
  createExtension,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import type { Messages } from "@/i18n/messages/en";
import { childPagesBlock } from "./child-pages-block";
import { childBoardBlock } from "./child-board-block";
import { childTableBlock } from "./child-table-block";
import { linkPreviewBlock } from "./link-preview-block";
import { mermaidBlock } from "./mermaid-block";
import { pdfBlock } from "./pdf-block";
import { videoEmbedBlock } from "./video-embed-block";
import { codeBlock } from "./code-block";
import { maskedBlock } from "./masked-block";
import { chatBlock } from "./chat-block";
import { whiteboardBlock } from "./whiteboard-embed-block";
import { tocBlock } from "./toc-block";
import { continueList, todoBlock } from "./todo-block";
import { mentionInline } from "./mention-inline";
import { toggleEnter } from "./toggle-enter";
import { backspaceOutdent } from "./backspace-outdent";
import { gridCellBlock, gridRowBlock, gridTableBlock, newGridTable } from "./grid-table-block";
import { HEADING_LEVELS } from "./block-configs";

// The editor's block types: BlockNote's defaults plus knowlective's own. Block
// types are saved in page documents, so a custom type must never be removed
// or renamed once released — pages using it would no longer load.
//
// Headings start at H2: the page title is the page's one H1. Without level 1
// in the schema it isn't offered (slash menu, toolbar, "# ", Ctrl+Alt+1);
// H1s that still arrive (pasted HTML, older pages) are turned into H2 by the
// editor (demoteH1 in collaborative-editor.tsx).
//
// Mentions (@name) are inline content of our own (mention-inline.tsx).
//
// Columns (2 or 3 side by side, each holding blocks) are BlockNote's
// xl-multi-column: the "column" and "columnList" types.
//
// The extended table (cells holding blocks) is ours, built the same way:
// "gridTable", "gridRow" and "gridCell" (grid-table-block.ts).
//
// The check list is replaced by the TODO block (todo-block.tsx) in the menus
// and shortcuts ("[ ] "); its type stays for the check lists already in
// pages, with Enter still continuing them.
export { HEADING_LEVELS };

// Enter in a toggle's title keeps the blocks inside it (toggle-enter.ts);
// ahead of the block's own Enter. Backspace at the start of an indented
// block takes it out a level (backspace-outdent.ts; for every block, it's
// just carried here).
function withToggleEnter<T extends { extensions?: readonly unknown[] }>(spec: T): T {
  return { ...spec, extensions: [toggleEnter, backspaceOutdent, ...(spec.extensions ?? [])] as unknown as T["extensions"] };
}

export const editorSchema = withMultiColumn(BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock,
    checkListItem: {
      ...defaultBlockSpecs.checkListItem,
      extensions: [
        createExtension({
          key: "knowlective-check-list",
          keyboardShortcuts: { Enter: ({ editor }) => continueList(editor, "checkListItem") },
        }),
      ] as typeof defaultBlockSpecs.checkListItem.extensions,
    },
    heading: withToggleEnter(createHeadingBlockSpec({ levels: HEADING_LEVELS, defaultLevel: 2 })),
    toggleListItem: withToggleEnter(defaultBlockSpecs.toggleListItem),
    childPages: childPagesBlock(),
    childTable: childTableBlock(),
    childBoard: childBoardBlock(),
    mermaid: mermaidBlock(),
    pdf: pdfBlock(),
    linkPreview: linkPreviewBlock(),
    videoEmbed: videoEmbedBlock(),
    maskedText: maskedBlock(),
    chat: chatBlock(),
    whiteboard: whiteboardBlock(),
    toc: tocBlock(),
    todo: todoBlock(),
    gridTable: gridTableBlock,
    gridRow: gridRowBlock,
    gridCell: gridCellBlock,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: mentionInline,
  },
}));

export type KnowlectiveEditor = typeof editorSchema.BlockNoteEditor;

type SlashKey = keyof Messages["editor"]["slash"];

// BlockNote's slash menu items with its check list replaced by the TODO
// block, in the same place (its group, its icon).
export function withTodoForChecklist(
  items: DefaultReactSuggestionItem[],
  editor: KnowlectiveEditor,
  t: (key: `editor.slash.${SlashKey}`) => string,
): DefaultReactSuggestionItem[] {
  return items.map((item) =>
    (item as { key?: string }).key === "check_list"
      ? {
          ...item,
          title: t("editor.slash.todo"),
          subtext: t("editor.slash.todoSub"),
          aliases: [
            "todo",
            "task",
            "checklist",
            "check",
            "checkbox",
            ...t("editor.slash.todoAliases").split(",").filter(Boolean),
          ],
          onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "todo" }),
        }
      : item,
  );
}

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
    {
      title: t("editor.slash.whiteboard"),
      subtext: t("editor.slash.whiteboardSub"),
      aliases: aliases("whiteboardAliases", ["whiteboard", "board", "canvas", "drawing", "figure"]),
      group: t("editor.slash.diagramGroup"),
      icon: <span aria-hidden>▦</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "whiteboard" }),
    },
    {
      title: t("editor.slash.toc"),
      subtext: t("editor.slash.tocSub"),
      aliases: aliases("tocAliases", ["toc", "contents", "table of contents", "outline", "index"]),
      group: t("editor.slash.otherGroup"),
      icon: <span aria-hidden>☰</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "toc" }),
    },
    {
      title: t("editor.slash.gridTable"),
      subtext: t("editor.slash.gridTableSub"),
      aliases: aliases("gridTableAliases", ["table", "grid", "extended", "header", "cells"]),
      group: t("editor.slash.otherGroup"),
      icon: <span aria-hidden>▦</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, newGridTable() as never),
    },
    {
      title: t("editor.slash.chat"),
      subtext: t("editor.slash.chatSub"),
      aliases: aliases("chatAliases", ["chat", "message", "talk", "conversation", "thread"]),
      group: t("editor.slash.otherGroup"),
      icon: <span aria-hidden>💬</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "chat" }),
    },
    {
      title: t("editor.slash.maskedText"),
      subtext: t("editor.slash.maskedTextSub"),
      aliases: aliases("maskedTextAliases", ["mask", "crypt", "encrypt", "secret", "password", "passphrase", "lock"]),
      group: t("editor.slash.otherGroup"),
      icon: <span aria-hidden>🔒</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "maskedText" }),
    },
  ];
}

// The "@" menu: the people who can open the page; choosing one puts a
// mention of them in the text (notifying them, server/notifications.ts).
export function mentionMenuItems(
  editor: KnowlectiveEditor,
  people: { id: string; name: string }[],
  query: string,
): DefaultReactSuggestionItem[] {
  const q = query.normalize("NFKC").toLowerCase();
  return people
    .filter((p) => p.name.normalize("NFKC").toLowerCase().includes(q))
    .slice(0, 20)
    .map((p) => ({
      title: p.name,
      onItemClick: () => editor.insertInlineContent([{ type: "mention", props: { userId: p.id } }, " "]),
    }));
}
