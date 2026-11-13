import assert from "node:assert/strict";
import { test } from "node:test";
import { staleBlockIds } from "../src/lib/sync-guard";

// Blocks an editor still shows after the shared document lost them (issue #41).
//   pnpm --filter web test:unit

const s = (...ids: string[]) => new Set(ids);

test("in step: nothing is stale", () => {
  assert.deepEqual(staleBlockIds(s("a", "b"), s("a", "b", "c"), s("a", "b"), s("a", "b")), []);
});

test("a block deleted elsewhere, still in this editor, is stale", () => {
  assert.deepEqual(staleBlockIds(s("a", "cal"), s("a", "cal"), s("a"), s("a", "cal")), ["cal"]);
});

test("a block this person just deleted isn't", () => {
  assert.deepEqual(staleBlockIds(s("a", "cal"), s("a"), s("a"), s("a", "cal")), []);
});

test("cut and pasted back (same id): not stale", () => {
  // The cut already reached the shared document; the paste is new here.
  assert.deepEqual(staleBlockIds(s("a"), s("a", "cal"), s("a"), s("a", "cal")), []);
});

test("blocks only in this editor so far (never shared) aren't", () => {
  assert.deepEqual(staleBlockIds(s("a", "new"), s("a", "new"), s("a"), s("a")), []);
});
