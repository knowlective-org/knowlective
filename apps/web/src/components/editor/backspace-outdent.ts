import { createExtension, getBlockInfoFromSelection, type BlockNoteEditor } from "@blocknote/core";

// Backspace at the start of an indented block (one nested under another
// with Tab) takes it back out one level, keeping its type, as Shift+Tab
// does. BlockNote first turns any block that isn't a paragraph (list items,
// headings, TODOs) into a paragraph, so Tab and then Backspace on a list
// item lost the list instead of undoing the indent. Blocks at the top level
// (also those directly in a column or a cell of the extended table) keep
// BlockNote's behaviour.
export function outdentAtStart(editor: Pick<BlockNoteEditor, "prosemirrorState" | "unnestBlock">): boolean {
  const state = editor.prosemirrorState;
  if (!state.selection.empty) return false;
  const info = getBlockInfoFromSelection(state);
  if (!info.isBlockContainer || state.selection.from !== info.blockContent.beforePos + 1) return false;
  // Nested: in a blockGroup that is the children of another block.
  const $block = state.doc.resolve(info.bnBlock.beforePos);
  if ($block.parent.type.name !== "blockGroup" || $block.depth < 2) return false;
  if ($block.node($block.depth - 1).type.name !== "blockContainer") return false;
  editor.unnestBlock();
  return true;
}

export const backspaceOutdent = createExtension({
  key: "knowlective-backspace-outdent",
  keyboardShortcuts: { Backspace: ({ editor }) => outdentAtStart(editor) },
});
