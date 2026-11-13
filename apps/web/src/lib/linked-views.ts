// Linked views: a child page table, board or calendar showing the child pages
// of another page (its `source` prop) instead of its own page's. Shared by
// the editor, the server and the export — keep dependency-free.
//
// `source`:
// - "": the block's own page (an ordinary child page table, board or calendar)
// - LINKED_UNSET: a linked view whose page hasn't been chosen yet (just
//   inserted from the slash menu)
// - a page id: that page's child pages, with each viewer's own access
//
// A linked view never changes the source's columns (adding, renaming,
// deleting, options): that's done where the columns are, on the source page.
// Child pages can be created from it (under the source, with EDIT there).

export const LINKED_UNSET = "unset";

// The block types that can be linked views.
export const LINKABLE_BLOCKS = ["childTable", "childBoard", "childCalendar"] as const;
export type LinkableBlock = (typeof LINKABLE_BLOCKS)[number];

// The page id a block's `source` names, or null for its own page or one not
// chosen yet. Page ids are cuids: anything else is ignored (it comes from the
// shared document).
export function linkedSource(source: unknown): string | null {
  return typeof source === "string" && source !== LINKED_UNSET && /^[A-Za-z0-9_-]{1,64}$/.test(source) ? source : null;
}

// Whether the block is a linked view (chosen or not).
export function isLinkedView(source: unknown): boolean {
  return source === LINKED_UNSET || linkedSource(source) !== null;
}
