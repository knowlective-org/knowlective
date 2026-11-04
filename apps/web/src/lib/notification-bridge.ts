// How the app (Next.js: Server Actions) asks the notifier, which runs in the
// custom server (server/notifications.ts: it sends desktop notifications and
// sees every stored page), to notify. Separate module graphs in one process,
// so the notifier registers itself on globalThis — keep dependency-free.

type NotificationBridge = {
  chatPosted(event: { pageId: string; blockId: string; actorId: string; text: string }): Promise<void>;
  // The server's key for Web Push (VAPID), made the first time it's asked for.
  pushPublicKey(): Promise<string>;
  // A test desktop notification to a person's devices: how many it went to.
  testPush(userId: string): Promise<number>;
};

const BRIDGE_KEY = Symbol.for("knowlective.notification-bridge");

export function registerNotificationBridge(bridge: NotificationBridge) {
  (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = bridge;
}

function bridge(): NotificationBridge | undefined {
  return (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as NotificationBridge | undefined;
}

// A new chat message: tells those in that chat. Never fails the caller (a
// no-op outside the custom server, e.g. scripts).
export async function notifyChatPosted(event: { pageId: string; blockId: string; actorId: string; text: string }) {
  await bridge()
    ?.chatPosted(event)
    .catch((err) => console.error("[notifications] notifying a chat message failed", err));
}

// The key a browser subscribes to desktop notifications with; null outside
// the custom server, or when it can't be made (before the first setup).
export async function pushPublicKey(): Promise<string | null> {
  return (await bridge()?.pushPublicKey().catch(() => null)) ?? null;
}

export async function sendTestPush(userId: string): Promise<number> {
  return (await bridge()?.testPush(userId).catch(() => 0)) ?? 0;
}
