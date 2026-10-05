// The site's public URL, as an origin only: "https://yosuga.example.com" or
// "http://localhost:3000". Paths aren't supported (the app is served from /).

export class InvalidPublicUrlError extends Error {}

export function normalizePublicUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidPublicUrlError("URL の形式が正しくありません（例: https://yosuga.example.com）。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidPublicUrlError("http:// または https:// で始まる URL を入力してください。");
  }
  if (url.username || url.password) {
    throw new InvalidPublicUrlError("URL にユーザー名やパスワードは含められません。");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new InvalidPublicUrlError("パスやクエリを含まない URL を入力してください（例: https://yosuga.example.com）。");
  }
  return url.origin;
}

// Plain http is only reasonable for local development.
export function isInsecurePublicUrl(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
