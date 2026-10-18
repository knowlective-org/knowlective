// The site's public URL, as an origin only: "https://knowlective.example.com" or
// "http://localhost:3000". Paths aren't supported (the app is served from /).

// What's wrong with the URL; the app shows its own text for each.
export type InvalidPublicUrlReason = "format" | "scheme" | "credentials" | "path";

export class InvalidPublicUrlError extends Error {
  constructor(readonly reason: InvalidPublicUrlReason) {
    super(`invalid public URL: ${reason}`);
  }
}

export function normalizePublicUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidPublicUrlError("format");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new InvalidPublicUrlError("scheme");
  if (url.username || url.password) throw new InvalidPublicUrlError("credentials");
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw new InvalidPublicUrlError("path");
  return url.origin;
}

// Plain http is only reasonable for local development.
export function isInsecurePublicUrl(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
