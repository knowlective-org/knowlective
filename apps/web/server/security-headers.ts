import type { OutgoingHttpHeaders, ServerResponse } from "node:http";

// Baseline security headers on every response (pages, Route Handlers,
// attachments). Anything that needs stricter values sets them itself and
// keeps them: the admin console (next.config.ts: no framing at all, no
// Referer), token pages (no Referer), the brand logo (a sandboxing CSP). So
// they're added only when the response is sent, and only those it doesn't
// have (a Route Handler's own headers don't replace ones set earlier).
//
// - Framing only by the site itself (clickjacking).
// - No MIME sniffing: an attachment is never run as something else than its
//   declared type.
// - CSP: no <base> rewriting, no plugins. Scripts aren't restricted here yet:
//   Next.js's inline scripts would need per-request nonces.
// - Referer: only the origin to other sites (page URLs carry page ids).
// - No camera, microphone, location or payment APIs.
// HSTS is left to the reverse proxy, which terminates HTTPS.
const HEADERS: [string, string][] = [
  ["X-Frame-Options", "SAMEORIGIN"],
  ["Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
];

// Header names given straight to writeHead (an object, or a flat array of
// name, value, name, value…), lowercased.
function namesIn(headers: unknown): Set<string> {
  const names = new Set<string>();
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      const name = headers[i];
      if (typeof name === "string") names.add(name.toLowerCase());
      else if (Array.isArray(name) && typeof name[0] === "string") names.add(name[0].toLowerCase());
    }
  } else if (headers && typeof headers === "object") {
    for (const name of Object.keys(headers as OutgoingHttpHeaders)) names.add(name.toLowerCase());
  }
  return names;
}

export function applySecurityHeaders(res: ServerResponse): void {
  const writeHead = res.writeHead;
  // Every response goes through writeHead (Node calls it for implicit headers too).
  res.writeHead = function (this: ServerResponse, ...args: unknown[]) {
    const given = namesIn(args.find((a, i) => i > 0 && typeof a === "object"));
    for (const [name, value] of HEADERS) {
      if (!this.hasHeader(name) && !given.has(name.toLowerCase())) this.setHeader(name, value);
    }
    return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as ServerResponse["writeHead"];
}
