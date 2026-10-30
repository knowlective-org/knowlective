// The color of a person's cursor in collaborative editing, stable per user.
// Shared by the editor (browser) and the collab server, which sets it on
// every cursor (server/collab.ts) — keep dependency-free.

const CURSOR_COLORS = ["#5b8def", "#e5484d", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f"];

export function cursorColorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}
