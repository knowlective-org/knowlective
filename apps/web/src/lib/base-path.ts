// The sub-path the app is served under, e.g. "/yosuga" for
// https://example.com/yosuga/ — "" (the default) when it's served from the
// root. Set with the YOSUGA_BASE_PATH environment variable; everything is
// under it: pages, /admin, /api and the collaboration WebSocket.
//
// Next.js adds it by itself to <Link>, router.push(), redirect() and its own
// assets. It does NOT add it to paths written by hand, so those go through
// withBasePath(): fetch() calls, plain <a href> / <form action>, Location
// headers and cookie paths written in Route Handlers, and the WebSocket URL.
//
// No dependencies: read by the browser, by Next.js's server code and by the
// custom server (server/).

export function normalizeBasePath(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (value === "") return "";
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(value)) {
    throw new Error(`YOSUGA_BASE_PATH must look like "/yosuga" or "/tools/yosuga" (got "${raw}")`);
  }
  return value;
}

// In code Next.js bundles (browser and server), NEXT_PUBLIC_BASE_PATH is
// written into the bundle at build time (next.config.ts). The custom server
// isn't bundled and reads the environment variable itself.
export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.YOSUGA_BASE_PATH);

// `path`: an absolute path inside the app, e.g. "/api/files/abc".
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}

// A URL kept in a page's document or in the database. Files are stored as
// "/api/files/<id>", without the base path, so the same data works wherever
// the app is served from; this makes it a URL the browser can load. Anything
// that isn't a path inside the app (an external image, say) is left alone.
export function resolveAppUrl(url: string): string {
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  return withBasePath(url);
}
