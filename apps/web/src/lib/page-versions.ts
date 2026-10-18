// Page history. Shared by the collab server, which saves versions,
// and the app, which lists and restores them — keep dependency-free.

// While a page is being edited, a version is saved at most this often. One
// is also saved when everyone has left the page.
export const VERSION_INTERVAL_MS = 10 * 60 * 1000;

// AAD for a version's encrypted Yjs state.
export const versionAad = (pageId: string, versionId: string) => `knowlective:page-version:${pageId}:${versionId}`;

export type PageVersionKind = "AUTO" | "INITIAL" | "BEFORE_RESTORE" | "RESTORED";

// Kinds shown with a label in the history (history.kinds): all but AUTO.
export const LABELLED_VERSION_KINDS = ["INITIAL", "BEFORE_RESTORE", "RESTORED"] as const;
