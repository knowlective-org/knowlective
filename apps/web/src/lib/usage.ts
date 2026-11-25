import type { PrismaClient } from "shared";

// Usage counts for the admin console's dashboard (/admin/usage): per day,
// person, channel and metric, in UsageDaily. Only counts — never what was
// read or written. Loaded by both the Next.js bundle and the custom server
// (server/collab.ts), so it takes the Prisma client instead of importing one.

export type UsageChannel = "WEB" | "API" | "MCP";
export type UsageMetric = "edit" | "upload" | "uploadBytes" | "read" | "write";

export type UsageEntry = {
  userId: string;
  channel: UsageChannel;
  metric: UsageMetric;
  // The API key ("key:<id>") or connected app ("app:<client id>") it came through.
  via?: string;
  // The MCP tool.
  detail?: string;
  count?: number;
};

// How long rows are kept (two years).
export const USAGE_KEEP_DAYS = 730;

// The day in the server's time zone (like the overdue TODO check), as YYYY-MM-DD.
export function usageDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Adds to today's count. Never throws and isn't awaited by callers: a
// missed count must not fail the request it counts.
export function recordUsage(db: PrismaClient, entry: UsageEntry): void {
  const count = Math.max(0, Math.round(entry.count ?? 1));
  if (count === 0) return;
  // One statement, so concurrent requests add up instead of racing on the insert.
  db.$executeRaw`
    INSERT INTO "UsageDaily" ("day", "userId", "channel", "metric", "via", "detail", "count")
    VALUES (${usageDay()}::date, ${entry.userId}, ${entry.channel}, ${entry.metric}, ${entry.via ?? ""}, ${(entry.detail ?? "").slice(0, 100)}, ${BigInt(count)})
    ON CONFLICT ("day", "userId", "channel", "metric", "via", "detail")
    DO UPDATE SET "count" = "UsageDaily"."count" + EXCLUDED."count"
  `.catch((err: unknown) => {
    // A user deleted meanwhile (foreign key): nothing to count.
    console.error("[usage] counting failed", err instanceof Error ? err.message : err);
  });
}

// Deletes rows older than USAGE_KEEP_DAYS.
export async function pruneUsage(db: PrismaClient): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - USAGE_KEEP_DAYS);
  const { count } = await db.usageDaily.deleteMany({ where: { day: { lt: new Date(`${usageDay(cutoff)}T00:00:00Z`) } } });
  return count;
}
