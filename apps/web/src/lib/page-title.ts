// Shared by the editor (browser) and the collab server — keep dependency-free.
//
// A page's title lives in its Yjs document as Y.Text TITLE_FIELD, next to the
// BlockNote fragment, so collaborators see title edits live. The collab
// server copies it into Page.title (the DB column the sidebar, home page and
// knowledge root name read) whenever the document is stored.

export const TITLE_FIELD = "title";
export const MAX_TITLE_LENGTH = 200;

// Shown for a page whose title is empty.
export const UNTITLED = "無題";

export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}

export function displayTitle(title: string): string {
  return title.trim() || UNTITLED;
}
