import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { parseServerKey } from "./crypto";

// Short-lived tokens that let a browser open one page on the collab server.
// apps/web mints them for a logged-in member; apps/collab verifies them.
// The HMAC key is derived from KNOWLECTIVE_SERVER_KEY, which both processes
// already have, so no extra shared secret is needed.
//
// Format: <payload base64url>.<HMAC-SHA256 base64url>

export const COLLAB_TOKEN_TTL_SECONDS = 5 * 60;

export type CollabTokenPayload = {
  /** userId */
  u: string;
  /** pageId (= Hocuspocus document name) */
  p: string;
  /** expiry, unix seconds */
  exp: number;
};

let cachedKey: Buffer | null = null;

function signingKey(): Buffer {
  cachedKey ??= Buffer.from(
    hkdfSync("sha256", parseServerKey(), Buffer.alloc(0), "knowlective:collab-token:v1", 32),
  );
  return cachedKey;
}

function sign(data: string): Buffer {
  return createHmac("sha256", signingKey()).update(data).digest();
}

export function createCollabToken(userId: string, pageId: string, now = Date.now()): string {
  const payload: CollabTokenPayload = {
    u: userId,
    p: pageId,
    exp: Math.floor(now / 1000) + COLLAB_TOKEN_TTL_SECONDS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data).toString("base64url")}`;
}

// Returns null for anything malformed, forged, or expired.
export function verifyCollabToken(token: string, now = Date.now()): CollabTokenPayload | null {
  const [data, mac, ...rest] = token.split(".");
  if (!data || !mac || rest.length > 0) return null;
  const expected = sign(data);
  const actual = Buffer.from(mac, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as CollabTokenPayload;
    if (typeof payload.u !== "string" || typeof payload.p !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
