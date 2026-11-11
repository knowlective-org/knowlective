// Links to this site open in the same tab (pages, search, …); links to other
// sites keep opening in a new one. No dependencies (unit tests:
// test/input-checks.test.ts).

// The app path (without the base path, as router.push() takes it) that
// `href` leads to when it's on this site (`origin`, served under
// `basePath`), or null. Attachments and other /api routes are left to open
// as before (a file shouldn't replace the page being read).
export function sameSitePath(href: string, origin: string, basePath: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  let path = url.pathname;
  if (basePath) {
    if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
    path = path.slice(basePath.length) || "/";
  }
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("/_next/")) return null;
  return `${path}${url.search}${url.hash}`;
}
