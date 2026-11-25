import { encrypt, loadDataKey } from "shared";
import { auditTranslator } from "@/i18n/audit";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { versionAad } from "@/lib/page-versions";
import { planRetention, retentionCutoff } from "@/lib/version-retention";
import { storedVersionState } from "@/lib/version-store";

// Deletes page versions older than the retention period
// (InstanceConfig.versionRetentionDays; null keeps them forever), and the
// presentation snapshots from before it. Which versions: lib/version-retention.ts.
// Runs hourly in the server (not on requests, so it runs on days nobody
// visits), page by page in small batches. Each pass that deletes anything is
// recorded in the audit log.
//
// Safe to run in two processes at once: every write is conditional and the
// deletes are idempotent. A kept version stored as a difference from a
// deleted one is stored whole first; a page where that didn't happen (e.g.
// masked meanwhile) is left for the next pass.

const PASS_INTERVAL_MS = 60 * 60 * 1000;
const PAGES_PER_BATCH = 50;
// A pass stops after this long; the next one continues.
const PASS_BUDGET_MS = 5 * 60 * 1000;

export type CleanupResult = { versions: number; snapshots: number; pages: number };

// One page. Returns how many versions were deleted, or -1 if the page was
// left for the next pass.
export async function cleanPage(pageId: string, cutoff: Date, key: Buffer): Promise<number> {
  const rows = await prisma.pageVersion.findMany({
    where: { pageId },
    select: { id: true, createdAt: true, baseId: true, depth: true },
  });
  const plan = planRetention(rows, cutoff);
  if (plan.remove.length === 0) return 0;
  const baseOf = new Map(rows.map((r) => [r.id, r.baseId]));

  // Read before anything changes: the chains still reach their bases.
  const whole = new Map<string, Uint8Array>();
  for (const id of plan.rebase) whole.set(id, await storedVersionState(prisma, key, pageId, id));

  const deleted = await prisma.$transaction(async (tx) => {
    for (const id of plan.rebase) {
      // Only while it's still the same difference (masking rebuilds versions).
      await tx.pageVersion.updateMany({
        where: { id, pageId, baseId: baseOf.get(id) },
        data: { state: Uint8Array.from(encrypt(key, whole.get(id)!, versionAad(pageId, id))), baseId: null, depth: 0 },
      });
    }
    for (const [id, depth] of plan.depths) {
      if (!plan.rebase.includes(id)) await tx.pageVersion.updateMany({ where: { id, pageId }, data: { depth } });
    }
    // Nothing kept may still be a difference from what goes.
    const dependent = await tx.pageVersion.count({
      where: { pageId, baseId: { in: plan.remove }, id: { notIn: plan.remove } },
    });
    if (dependent > 0) throw new SkipPage();
    const { count } = await tx.pageVersion.deleteMany({ where: { pageId, id: { in: plan.remove } } });
    return count;
  }).catch((err) => {
    if (err instanceof SkipPage) return -1;
    throw err;
  });
  return deleted;
}

class SkipPage extends Error {}

// One pass. Does nothing while no retention period is set.
export async function cleanUpOldVersions(now = new Date()): Promise<CleanupResult | null> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { versionRetentionDays: true } });
  const days = config?.versionRetentionDays;
  if (!days) return null;
  const cutoff = retentionCutoff(days, now);
  const key = await loadDataKey(prisma);
  const deadline = Date.now() + PASS_BUDGET_MS;

  const result: CleanupResult = { versions: 0, snapshots: 0, pages: 0 };
  const skipped: string[] = [];
  let finished = false;
  while (Date.now() < deadline) {
    // Pages with more than one version from before the cutoff.
    const batch = await prisma.$queryRaw<{ pageId: string }[]>`
      SELECT "pageId" FROM "PageVersion"
      WHERE "createdAt" < ${cutoff} AND NOT ("pageId" = ANY (${skipped}::text[]))
      GROUP BY "pageId" HAVING count(*) > 1
      LIMIT ${PAGES_PER_BATCH}`;
    if (batch.length === 0) {
      finished = true;
      break;
    }
    for (const { pageId } of batch) {
      try {
        const n = await cleanPage(pageId, cutoff, key);
        if (n > 0) {
          result.versions += n;
          result.pages++;
        } else {
          skipped.push(pageId);
        }
      } catch (err) {
        console.error(`[versions] cleaning up the history of page ${pageId} failed`, err);
        skipped.push(pageId);
      }
      if (Date.now() >= deadline) break;
    }
  }
  if (finished) {
    // The versions a snapshot from before the cutoff names may be gone.
    const { count } = await prisma.presentationSnapshot.deleteMany({ where: { createdAt: { lt: cutoff } } });
    result.snapshots = count;
  }

  await prisma.instanceConfig.update({
    where: { id: 1 },
    data: { versionCleanupAt: now, versionCleanupDeleted: result.versions + result.snapshots },
  });
  if (result.versions > 0 || result.snapshots > 0) {
    const audit = await auditTranslator();
    await recordAudit(
      { userId: null, label: audit("audit.systemActor") },
      "page.version.retention",
      audit("audit.versionRetentionDeleted", {
        versions: result.versions,
        pages: result.pages,
        snapshots: result.snapshots,
        days,
      }),
      { ...result, days, cutoff: cutoff.toISOString() },
    );
    console.log(
      `[versions] deleted ${result.versions} version(s) of ${result.pages} page(s) and ${result.snapshots} presentation snapshot(s) older than ${days} day(s)`,
    );
  }
  return result;
}

// The hourly pass (once per server).
export function startVersionCleanup(): void {
  const flag = Symbol.for("knowlective.version-cleanup");
  const g = globalThis as Record<symbol, unknown>;
  if (g[flag]) return;
  g[flag] = true;
  const pass = async () => {
    try {
      await cleanUpOldVersions();
    } catch (err) {
      console.error("[versions] the cleanup pass failed", err);
    } finally {
      setTimeout(pass, PASS_INTERVAL_MS).unref();
    }
  };
  setTimeout(pass, 10 * 60_000).unref();
}
