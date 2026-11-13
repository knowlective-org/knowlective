import type { KeyboardEvent } from "react";

// Tab (and Shift+Tab) in the text that nothing in the editor used — a list
// item or TODO that can't be indented further (the first in its list, or
// empty with nothing to nest under), the top level for Shift+Tab — does
// nothing. The browser would otherwise move the focus to the next control
// on the page, such as a TODO's checkbox further down. Whatever the editor
// handles (indenting, code blocks, table cells) has already called
// preventDefault() by the time this runs (it's on an element around the
// editor, so it gets the key after ProseMirror). Keys in a block's own
// fields (inputs) keep moving the focus, and so does Tab while BlockNote's
// formatting or link toolbar is open: it moves into the toolbar.
export function keepTabInEditor(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (!target.classList?.contains("ProseMirror") || !target.isContentEditable) return;
  if (document.querySelector(".bn-formatting-toolbar, .bn-link-toolbar")) return;
  e.preventDefault();
}
