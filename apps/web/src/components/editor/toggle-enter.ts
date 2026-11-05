import { createExtension, getBlockInfoFromSelection, type BlockNoteEditor } from "@blocknote/core";

// Enter in the title of a toggle (toggle list item or toggle heading) that
// has blocks inside. BlockNote splits the block, and the blocks inside go
// with the new one below it — out of the toggle the person was typing in.
// Instead they stay where they are:
// - at the start of the title: an empty paragraph above the toggle;
// - open toggle: the text after the cursor becomes the first block inside;
// - closed toggle: a new toggle of the same kind below, with that text.
// Toggles without blocks inside keep BlockNote's behaviour.

function isOpen(id: string): boolean {
  // BlockNote's own record of open toggles (createToggleWrapper.ts).
  try {
    return window.localStorage.getItem(`toggle-${id}`) === "true";
  } catch {
    return false;
  }
}

export function enterInToggle(editor: Pick<BlockNoteEditor, "transact" | "setTextCursorPosition">): boolean {
  let cursorTo: string | null = null;
  const handled = editor.transact((tr) => {
    const info = getBlockInfoFromSelection(tr);
    if (!info.isBlockContainer || !info.childContainer || !tr.selection.empty) return false;
    const content = info.blockContent.node;
    const toggle = content.type.name === "toggleListItem" || (content.type.name === "heading" && content.attrs.isToggleable);
    // An empty toggle list item turns into a paragraph (BlockNote's), keeping its blocks under it.
    if (!toggle || content.childCount === 0) return false;
    const schema = tr.doc.type.schema;
    const from = tr.selection.from;
    const contentStart = info.blockContent.beforePos + 1;
    const contentEnd = info.blockContent.afterPos - 1;
    const id = crypto.randomUUID();
    if (from === contentStart) {
      tr.insert(info.bnBlock.beforePos, schema.nodes.blockContainer.create({ id }, schema.nodes.paragraph.create()));
      tr.scrollIntoView();
      return true;
    }
    const rest = tr.doc.slice(from, contentEnd).content;
    tr.delete(from, contentEnd);
    if (isOpen(info.bnBlock.node.attrs.id)) {
      const groupStart = tr.mapping.map(info.childContainer.beforePos) + 1;
      tr.insert(groupStart, schema.nodes.blockContainer.create({ id }, schema.nodes.paragraph.create(null, rest)));
    } else {
      const after = tr.mapping.map(info.bnBlock.afterPos);
      tr.insert(after, schema.nodes.blockContainer.create({ id }, content.type.create(content.attrs, rest)));
    }
    cursorTo = id;
    tr.scrollIntoView();
    return true;
  });
  if (cursorTo) editor.setTextCursorPosition(cursorTo, "start");
  return handled;
}

export const toggleEnter = createExtension({
  key: "knowlective-toggle-enter",
  // Ahead of the toggle list item's own Enter (BlockNote's).
  runsBefore: ["toggle-list-item-shortcuts"],
  keyboardShortcuts: { Enter: ({ editor }) => enterInToggle(editor) },
});
