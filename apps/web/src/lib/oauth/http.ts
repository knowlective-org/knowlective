import { getClientIp } from "@/lib/ip";
import { createRateLimiter } from "@/lib/rate-limit";
import { PUBLIC_CORS } from "./metadata";

// Request handling shared by the OAuth endpoints (/oauth/token, /register,
// /revoke): bodies, errors in OAuth's shape, limits per network address.
// They take no cookies (apps call them from their servers, or from a page
// on another site), so they answer CORS like the metadata.

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...PUBLIC_CORS, ...NO_STORE, ...headers } });
}

export function oauthError(error: string, description: string, status = 400, headers: Record<string, string> = {}): Response {
  return oauthJson({ error, error_description: description }, status, headers);
}

export const preflight = () => new Response(null, { status: 204, headers: PUBLIC_CORS });

const MAX_BODY = 64 * 1024;

// A form (application/x-www-form-urlencoded, as OAuth sends) or JSON body.
export async function readParams(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  const type = request.headers.get("content-type") ?? "";
  if (/^application\/x-www-form-urlencoded\b/i.test(type)) return Object.fromEntries(new URLSearchParams(text));
  if (/^application\/json\b/i.test(type)) {
    try {
      const body = JSON.parse(text) as unknown;
      return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Per network address, in this process.
export function limitPerAddress(windowMs: number, max: number) {
  const limited = createRateLimiter(windowMs, max);
  return (request: Request): Response | null => {
    const retryAfter = limited(getClientIp(request.headers));
    return retryAfter === null
      ? null
      : oauthError("slow_down", "Too many requests. Wait a moment and try again.", 429, { "Retry-After": String(retryAfter) });
  };
}
