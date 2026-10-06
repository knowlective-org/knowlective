// Shared by the collab server (server/collab.ts), Server Actions and the
// editor (browser) — keep dependency-free.
//
// Live updates for data that isn't in a page's Yjs document (its children's
// titles, timestamps and property values). The server sends a Hocuspocus
// stateless message on the parent page's document; editors showing a
// child-page block refetch through their Server Action, so every viewer only
// ever receives what their own permissions allow.

export const CHILDREN_CHANGED = "children-changed";

type CollabBridge = { notifyChildrenChanged(parentPageId: string): void };

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
