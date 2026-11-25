// Run once when the Next.js server starts (both `pnpm dev` and production).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Attachments not read for search yet (lib/file-search.ts).
  const { startFileTextBackfill } = await import("@/lib/file-search");
  startFileTextBackfill();
  // Attachments no page shows any more (lib/file-cleanup.ts).
  const { startFileCleanup } = await import("@/lib/file-cleanup");
  startFileCleanup();
  // Page versions older than the retention period (lib/version-cleanup.ts).
  const { startVersionCleanup } = await import("@/lib/version-cleanup");
  startVersionCleanup();
  // Usage counts older than the dashboard keeps (lib/usage.ts), daily.
  const { pruneUsage } = await import("@/lib/usage");
  const { prisma } = await import("@/lib/db");
  const prune = () => void pruneUsage(prisma).catch((err) => console.error("[usage] pruning failed", err));
  setTimeout(prune, 60_000).unref();
  setInterval(prune, 24 * 60 * 60 * 1000).unref();
  // A little later: the storage container may still be starting.
  const { warnIfBundledStorageDown } = await import("@/lib/storage");
  setTimeout(() => void warnIfBundledStorageDown(), 20_000).unref();
}
