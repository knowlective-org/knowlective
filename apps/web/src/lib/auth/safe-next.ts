// Where to go after logging in (?next=…): a path on this site, or `fallback`.
// No dependencies (unit-tested).
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next.includes("\\")) return fallback;
  // Browsers drop tabs and line breaks from URLs ("/<tab>/evil.example" becomes
  // "//evil.example", another site), and other control characters have no
  // place in a path.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
