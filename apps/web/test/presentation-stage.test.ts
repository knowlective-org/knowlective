import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_MOVES,
  MAX_STARTS,
  MOVE_WINDOW_MS,
  PresentingLimiter,
  START_WINDOW_MS,
  admitPresenting,
  currentStage,
  readPresenting,
} from "../src/lib/presentation-stage";

const base = {
  current: null,
  someoneElsePresenting: false,
  key: "user:deck",
  now: 1000,
  isShown: async () => true,
};

test("presenting state from awareness is read checked", () => {
  assert.deepEqual(readPresenting({ slideId: "abc_1", since: 5 }), { slideId: "abc_1", since: 5 });
  for (const bad of [null, "x", {}, { slideId: "a/b", since: 5 }, { slideId: "a", since: 0 }, { slideId: "a", since: 1.5 }, { slideId: 3, since: 5 }]) {
    assert.equal(readPresenting(bad), null);
  }
});

test("whoever started first is the presenter", () => {
  const stage = currentStage<{ presenting?: unknown }>([
    [3, { presenting: { slideId: "b", since: 20 } }],
    [9, {}],
    [7, { presenting: { slideId: "a", since: 10 } }],
    [2, { presenting: { slideId: "bad/id", since: 1 } }],
  ]);
  assert.equal(stage?.clientId, 7);
  assert.equal(currentStage([[1, {}]]), null);
});

test("starting takes the server's time, not the browser's", async () => {
  const got = await admitPresenting({ ...base, wanted: { slideId: "a", since: 1 }, limiter: new PresentingLimiter() });
  assert.deepEqual(got, { slideId: "a", since: 1000 });
});

test("nobody can start while someone else is presenting", async () => {
  const got = await admitPresenting({ ...base, someoneElsePresenting: true, wanted: { slideId: "a" }, limiter: new PresentingLimiter() });
  assert.equal(got, null);
});

test("a hidden or foreign slide can't be presented", async () => {
  const limiter = new PresentingLimiter();
  assert.equal(await admitPresenting({ ...base, wanted: { slideId: "a" }, limiter, isShown: async () => false }), null);
  const current = { slideId: "a", since: 5 };
  assert.deepEqual(await admitPresenting({ ...base, current, wanted: { slideId: "b" }, limiter, isShown: async () => false }), current);
});

test("malformed values stop presenting", async () => {
  for (const wanted of [null, "a", {}, { slideId: "../x" }]) {
    assert.equal(await admitPresenting({ ...base, current: { slideId: "a", since: 5 }, wanted, limiter: new PresentingLimiter() }), null);
  }
});

test("staying on a slide isn't counted as a move", async () => {
  const limiter = new PresentingLimiter();
  const current = { slideId: "a", since: 5 };
  for (let i = 0; i < MAX_MOVES * 2; i++) {
    assert.deepEqual(await admitPresenting({ ...base, current, wanted: { slideId: "a" }, limiter }), current);
  }
  assert.deepEqual(await admitPresenting({ ...base, current, wanted: { slideId: "b" }, limiter }), { slideId: "b", since: 5 });
});

test("repeated requests to everyone are limited", () => {
  const limiter = new PresentingLimiter();
  for (let i = 0; i < MAX_STARTS; i++) assert.equal(limiter.allowStart("k", 1000), true);
  assert.equal(limiter.allowStart("k", 1000), false);
  assert.equal(limiter.allowStart("other", 1000), true);
  assert.equal(limiter.allowStart("k", 1000 + START_WINDOW_MS), true);
});

test("rapid slide changes are limited and the slide stays", async () => {
  const limiter = new PresentingLimiter();
  for (let i = 0; i < MAX_MOVES; i++) assert.equal(limiter.allowMove("user:deck", 1000), true);
  const current = { slideId: "a", since: 5 };
  assert.deepEqual(await admitPresenting({ ...base, current, wanted: { slideId: "b" }, limiter }), current);
  assert.equal(limiter.allowMove("user:deck", 1000 + MOVE_WINDOW_MS), true);
});
