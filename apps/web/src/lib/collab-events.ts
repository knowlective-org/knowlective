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
// Sent to a page's editors right before the server closes them because the
// page moved under another parent: its access may have changed, so the
// editor reconnects (access is checked again) and the screen refreshes.
export const PAGE_MOVED = "page-moved";

type CollabBridge = {
  notifyChildrenChanged(parentPageId: string): void;
  closeDocuments(pageIds: string[]): void;
  reconnectDocuments(pageIds: string[]): void;
  restoreVersion(pageId: string, versionId: string, userId: string): Promise<void>;
  liveState(pageId: string): Uint8Array | null;
};

// The custom server and the Next.js bundle are separate module graphs in one
// process, so the collab server registers itself on globalThis.
const BRIDGE_KEY = Symbol.for("knowlective.collab-bridge");

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

// Tells everyone editing these pages that they moved (PAGE_MOVED), then
// disconnects them so they reconnect with their access checked again.
export function reconnectDocuments(pageIds: string[]) {
  const bridge = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as CollabBridge | undefined;
  bridge?.reconnectDocuments(pageIds);
}

// Replaces a page's content with one of its saved versions (page history).
// Throws outside the custom server: there is no document to change.
export async function restoreVersion(pageId: string, versionId: string, userId: string) {
  const bridge = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as CollabBridge | undefined;
  if (!bridge) throw new Error("The collaboration server is not running");
  await bridge.restoreVersion(pageId, versionId, userId);
}

// The page's document as currently open in the collab server (including
// edits not stored yet), or null if nobody has it open on this instance.
export function liveDocumentState(pageId: string): Uint8Array | null {
  const bridge = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as CollabBridge | undefined;
  return bridge?.liveState(pageId) ?? null;
}
