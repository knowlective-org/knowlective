// Shared by the collab server (server/collab.ts), Server Actions and the
// editor (browser) — keep dependency-free.
//
// Live updates for data that isn't in a page's Yjs document (its children's
// titles, timestamps and property values). The server sends a Hocuspocus
// stateless message on the parent page's document; editors showing a
// child-page block refetch through their Server Action, so every viewer only
// ever receives what their own permissions allow.

export const CHILDREN_CHANGED = "children-changed";
// Sent to a page's editors right before the server closes them because the
// page went to the trash. (Closing alone isn't enough: Hocuspocus closes only
// that document's channel on the shared socket, and the provider doesn't
// reconnect it, so the editor would silently stop saving.)
export const PAGE_DELETED = "page-deleted";

type CollabBridge = {
  notifyChildrenChanged(parentPageId: string): void;
  closeDocuments(pageIds: string[]): void;
  restoreVersion(pageId: string, versionId: string, userId: string): Promise<void>;
};

// The custom server and the Next.js bundle are separate module graphs in one
// process, so the collab server registers itself on globalThis.
const BRIDGE_KEY = Symbol.for("yosuga.collab-bridge");

export function registerCollabBridge(bridge: CollabBridge) {
  (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = bridge;
}

// Tells everyone editing `parentPageId` that its children changed. A no-op
// outside the custom server (e.g. scripts).
export function notifyChildrenChanged(parentPageId: string | null | undefined) {
  if (!parentPageId) return;
  const bridge = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as CollabBridge | undefined;
  bridge?.notifyChildrenChanged(parentPageId);
}

// Tells everyone editing these pages that they went to the trash
// (PAGE_DELETED), then disconnects them.
export function closeDocuments(pageIds: string[]) {
  const bridge = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as CollabBridge | undefined;
  bridge?.closeDocuments(pageIds);
}

// Replaces a page's content with one of its saved versions (履歴表示).
// Throws outside the custom server: there is no document to change.
export async function restoreVersion(pageId: string, versionId: string, userId: string) {
  const bridge = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as CollabBridge | undefined;
  if (!bridge) throw new Error("The collaboration server is not running");
  await bridge.restoreVersion(pageId, versionId, userId);
}
