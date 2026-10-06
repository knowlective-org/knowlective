"use client";

import { BlockNoteSchema, defaultBlockSpecs, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { childPagesBlock } from "./child-pages-block";
import { childTableBlock } from "./child-table-block";

// The editor's block types: BlockNote's defaults plus yosuga's own. Block
// types are saved in page documents, so a custom type must never be removed
// or renamed once released — pages using it would no longer load.
export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    childPages: childPagesBlock(),
    childTable: childTableBlock(),
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
  ];
}
