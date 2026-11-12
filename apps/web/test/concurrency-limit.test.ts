import assert from "node:assert/strict";
import { test } from "node:test";
import { createConcurrencyLimit } from "../src/lib/concurrency-limit";

// A cap on slow work running at once (lib/concurrency-limit.ts): beyond it a
// run is refused at once, not queued.

test("beyond the limit, refused at once; a place freed is taken again", async () => {
  const run = createConcurrencyLimit(2);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = () => gate.then(() => "done");
  const a = run(slow);
  const b = run(slow);
  assert.deepEqual(await run(slow), { ok: false });
  release();
  assert.deepEqual(await Promise.all([a, b]), [{ ok: true, value: "done" }, { ok: true, value: "done" }]);
  assert.deepEqual(await run(async () => 1), { ok: true, value: 1 });
});

test("a task that throws frees its place", async () => {
  const run = createConcurrencyLimit(1);
  await assert.rejects(run(async () => Promise.reject(new Error("x"))));
  assert.deepEqual(await run(async () => 2), { ok: true, value: 2 });
});
