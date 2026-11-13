// The access log's line for one request (server/access-log.ts writes it).
// Kept small: one line per request, no query string, user agent or referrer.
//
//   2026-11-13T01:02:03.456Z 203.0.113.5 GET /pages/abc 200 12 xff=198.51.100.7,10.0.0.1
//
// time, client IP (as the app takes it: lib/ip.ts), method, path, status
// ("-": the connection closed before the answer), milliseconds, and the
// X-Forwarded-For header as it came ("-": none).
//
// Dependency-free; unit-tested (test/access-log.test.ts). What's logged comes
// from the request, so it's cleaned up: nothing that would start another line
// or field, and nothing secret.

// Paths that carry a secret token (an invitation, a password reset, an email
// change) or an admin's test result: the token isn't logged.
const SECRET_PATH = /^(\/(?:invite|reset-password|email-change|admin\/oidc-test))\/[^/]+/;

const MAX_PATH = 300;
const MAX_FORWARDED = 200;

// `pathname` without the base path's prefix is matched; it's kept in the line.
export function logPath(pathname: string, basePath: string): string {
  const inside = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  const prefix = pathname.slice(0, pathname.length - inside.length);
  const path = prefix + inside.replace(SECRET_PATH, "$1/*");
  return clean(path, MAX_PATH) || "/";
}

export function logForwardedFor(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  // Addresses only: a client may send anything there.
  const out = clean(raw.replace(/\s+/g, ""), MAX_FORWARDED).replace(/[^\w.:,[\]%-]/g, "?");
  return out || "-";
}

export function accessLogLine(entry: {
  at: Date;
  ip: string;
  method: string;
  path: string;
  status: number | null;
  ms: number;
  forwardedFor: string;
}): string {
  const method = entry.method.replace(/[^A-Z]/g, "").slice(0, 10) || "?";
  const ip = clean(entry.ip, 64).replace(/\s/g, "") || "-";
  return `${entry.at.toISOString()} ${ip} ${method} ${entry.path} ${entry.status ?? "-"} ${Math.round(entry.ms)} xff=${entry.forwardedFor}\n`;
}

// Printable ASCII without spaces (pathnames are already percent-encoded),
// cut to `max`.
function clean(s: string, max: number): string {
  return s.replace(/[\u0000-\u0020\u007f-\uffff]/g, "?").slice(0, max);
}
