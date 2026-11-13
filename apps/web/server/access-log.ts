import type { IncomingMessage, ServerResponse } from "node:http";
import { BASE_PATH } from "../src/lib/base-path";
import { accessLogLine, logForwardedFor, logPath } from "../src/lib/access-log";
import { getClientIp, normalizeIp } from "../src/lib/ip";

// The access log: one line per request on standard output (the container's
// log; docker-compose.prod.yml caps its size). Format: src/lib/access-log.ts.
// KNOWLECTIVE_ACCESS_LOG=1 / 0 turns it on or off; on by default in
// production, off in development. Next.js's own files (/_next/) and the
// health check aren't logged: they'd be most of the lines.

export function accessLogEnabled(dev: boolean): boolean {
  const v = process.env.KNOWLECTIVE_ACCESS_LOG?.trim();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return !dev;
}

function skipped(pathname: string): boolean {
  return pathname.startsWith(`${BASE_PATH}/_next/`) || pathname === `${BASE_PATH}/api/health`;
}

// The client as the app takes it: X-Forwarded-For (lib/ip.ts), or the socket
// when there's none (as Next.js and the collab server do).
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (!forwarded) return normalizeIp(req.socket.remoteAddress ?? "");
  return getClientIp(new Headers({ "x-forwarded-for": Array.isArray(forwarded) ? forwarded.join(",") : forwarded }));
}

function write(req: IncomingMessage, method: string, pathname: string, status: number | null, started: number, forwardedFor: string) {
  process.stdout.write(
    accessLogLine({
      at: new Date(),
      ip: clientIp(req),
      method,
      path: logPath(pathname, BASE_PATH),
      status,
      ms: performance.now() - started,
      forwardedFor,
    }),
  );
}

// Logs the request when its answer is done (or the connection closes first).
export function logRequest(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (skipped(pathname)) return;
  const started = performance.now();
  // As it came, before anything fills it in.
  const forwardedFor = logForwardedFor(req.headers["x-forwarded-for"]);
  res.once("close", () => write(req, req.method ?? "", pathname, res.writableFinished ? res.statusCode : null, started, forwardedFor));
}

// A WebSocket (the collab connection): logged as "WS" when it's accepted
// (101) or refused.
export function logUpgrade(req: IncomingMessage, pathname: string, status: number) {
  if (skipped(pathname)) return;
  write(req, "WS", pathname, status, performance.now(), logForwardedFor(req.headers["x-forwarded-for"]));
}
