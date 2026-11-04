import { createHash } from "node:crypto";

// Where desktop notifications may be sent: a browser hands the server its
// push service's address for the device (a PushSubscription), and the server
// sends to it. Any other address would make the server send requests where
// someone chose (to the internal network, say), so only the browsers' push
// services are accepted: Chrome / Edge / Opera (Google), Firefox (Mozilla),
// Safari (Apple), Edge on Windows (Microsoft). Dependency-free, for the unit
// tests.

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname));
}

// A subscription as the browser gives it (PushSubscription.toJSON()), checked.
export type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };

const KEY = /^[A-Za-z0-9_-]{16,128}={0,2}$/;

export function parsePushSubscription(raw: unknown): PushSubscriptionData | null {
  if (!raw || typeof raw !== "object") return null;
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isPushEndpoint(endpoint) || !keys || typeof keys !== "object") return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !KEY.test(p256dh) || !KEY.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// How a device is found (PushSubscription.endpointHash) and what its stored
// subscription is bound to (the AAD of its encryption).
export const endpointHash = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");
export const subscriptionAad = (id: string) => `knowlective:push-subscription:${id}`;
