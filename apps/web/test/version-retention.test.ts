import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRetentionDays, planRetention, type RetentionRow } from "../src/lib/version-retention";

// Which page versions the retention period deletes (lib/version-retention.ts).
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));
const row = (id: string, d: number, baseId: string | null = null, depth = 0): RetentionRow => ({
  id,
  createdAt: day(d),
  baseId,
  depth,
});

describe("planRetention", () => {
  test("keeps the period and the newest version before it", () => {
    const rows = [row("a", 0), row("b", 1), row("c", 2), row("d", 10)];
    const plan = planRetention(rows, day(5));
    assert.deepEqual(plan.remove.sort(), ["a", "b"]);
    assert.deepEqual(plan.rebase, []);
  });

  test("a page whose versions are all old keeps its newest", () => {
    const plan = planRetention([row("b", 1), row("a", 0)], day(5));
    assert.deepEqual(plan.remove, ["a"]);
  });

  test("nothing to delete with one old version or none", () => {
    assert.deepEqual(planRetention([row("a", 0), row("b", 9)], day(5)).remove, []);
    assert.deepEqual(planRetention([row("a", 6)], day(5)).remove, []);
    assert.deepEqual(planRetention([], day(5)).remove, []);
  });

  test("a kept difference from a deleted version is stored whole, and depths follow", () => {
    const rows = [row("a", 0), row("b", 1, "a", 1), row("c", 2, "b", 2), row("d", 6, "c", 3), row("e", 7, "d", 4)];
    const plan = planRetention(rows, day(5));
    assert.deepEqual(plan.remove.sort(), ["a", "b"]);
    // c is kept (newest before the cutoff) and was based on b.
    assert.deepEqual(plan.rebase, ["c"]);
    assert.deepEqual([...plan.depths].sort(), [
      ["c", 0],
      ["d", 1],
      ["e", 2],
    ]);
  });

  test("whole versions and chains starting in the period are left alone", () => {
    const rows = [row("a", 0), row("b", 1, "a", 1), row("c", 6), row("d", 7, "c", 1)];
    const plan = planRetention(rows, day(5));
    assert.deepEqual(plan.remove, ["a"]);
    assert.deepEqual(plan.rebase, ["b"]);
    assert.deepEqual([...plan.depths], [["b", 0]]);
  });
});

describe("parseRetentionDays", () => {
  test("empty is forever, whole days in range only", () => {
    assert.equal(parseRetentionDays(""), null);
    assert.equal(parseRetentionDays(" 30 "), 30);
    assert.equal(parseRetentionDays("1"), 1);
    assert.equal(parseRetentionDays("36500"), 36500);
    for (const bad of ["0", "-1", "1.5", "1e3", "36501", "abc", "３０"]) assert.equal(parseRetentionDays(bad), "invalid", bad);
  });
});
