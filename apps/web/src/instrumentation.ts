// Run once when the Next.js server starts (both `pnpm dev` and production).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Attachments not read for search yet (lib/file-search.ts).
  const { startFileTextBackfill } = await import("@/lib/file-search");
  startFileTextBackfill();
}
