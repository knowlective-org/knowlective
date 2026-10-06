// Page history (履歴表示). Shared by the collab server, which saves versions,
// and the app, which lists and restores them — keep dependency-free.

// While a page is being edited, a version is saved at most this often. One
// is also saved when everyone has left the page.
export const VERSION_INTERVAL_MS = 10 * 60 * 1000;

// AAD for a version's encrypted Yjs state.
export const versionAad = (pageId: string, versionId: string) => `yosuga:page-version:${pageId}:${versionId}`;

export type PageVersionKind = "AUTO" | "INITIAL" | "BEFORE_RESTORE" | "RESTORED";

export const VERSION_KIND_LABELS: Record<PageVersionKind, string | null> = {
  AUTO: null,
  INITIAL: "履歴の開始時点",
  BEFORE_RESTORE: "復元の直前",
  RESTORED: "復元",
};
