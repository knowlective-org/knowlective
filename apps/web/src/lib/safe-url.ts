// Only http(s) links are shown as links: link and image URLs in blocks come
// from the shared document, where anyone who can edit the page can put
// anything. No dependencies (unit-tested).
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
