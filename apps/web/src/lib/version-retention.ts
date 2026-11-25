// Which saved versions of a page the retention period deletes
// (InstanceConfig.versionRetentionDays, lib/version-cleanup.ts). No
// dependencies: unit-tested.
//
// Kept: every version from the period, and the newest one from before it,
// so the page as it was at any moment in the period can still be restored
// (a presentation snapshot from the period names the version its slide was
// at, which is one of these). A page always keeps its newest version.

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 36500;

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

// The admin form's input: "" is forever (null); otherwise whole days in range.
export function parseRetentionDays(input: string): number | null | "invalid" {
  const text = input.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return "invalid";
  const days = Number(text);
  return days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS ? days : "invalid";
}

export type RetentionRow = { id: string; createdAt: Date; baseId: string | null; depth: number };

export type RetentionPlan = {
  // Versions to delete.
  remove: string[];
  // Kept versions stored as a difference from one being deleted: to be
  // stored whole first (lib/version-chain.ts).
  rebase: string[];
  // Kept versions whose count of differences changes (after rebasing).
  depths: Map<string, number>;
};

export function planRetention(rows: RetentionRow[], cutoff: Date): RetentionPlan {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const before = sorted.filter((r) => r.createdAt < cutoff);
  const remove = new Set(before.slice(0, -1).map((r) => r.id));
  const kept = sorted.filter((r) => !remove.has(r.id));

  const rebase: string[] = [];
  const depths = new Map<string, number>();
  const depthOf = new Map<string, number>();
  for (const row of kept) {
    let depth = row.depth;
    if (row.baseId && remove.has(row.baseId)) {
      rebase.push(row.id);
      depth = 0;
    } else if (row.baseId && depthOf.has(row.baseId)) {
      depth = depthOf.get(row.baseId)! + 1;
    } else if (!row.baseId) {
      depth = 0;
    }
    depthOf.set(row.id, depth);
    if (depth !== row.depth) depths.set(row.id, depth);
  }
  return { remove: [...remove], rebase, depths };
}
