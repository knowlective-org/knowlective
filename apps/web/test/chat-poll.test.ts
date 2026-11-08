import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_POLL_OPTIONS, MAX_POLL_OPTION_LENGTH, normalizePollOptions, normalizePollVote } from "../src/lib/chat-types";

// A chat poll's choices and votes (lib/chat-types.ts), as they come from the
// browser: the server stores only what these let through.
//   pnpm --filter web test:unit

describe("poll choices", () => {
  test("kept trimmed, each on one line", () => {
    assert.deepEqual(normalizePollOptions(["  ラーメン ", "そば\nうどん"]), ["ラーメン", "そば うどん"]);
  });
  test("too few, too many, empty or too long are refused", () => {
    assert.equal(normalizePollOptions(["only"]), null);
    assert.equal(normalizePollOptions(Array.from({ length: MAX_POLL_OPTIONS + 1 }, (_, i) => `c${i}`)), null);
    assert.equal(normalizePollOptions(["a", "  "]), null);
    assert.equal(normalizePollOptions(["a", "x".repeat(MAX_POLL_OPTION_LENGTH + 1)]), null);
    assert.ok(normalizePollOptions(["a", "x".repeat(MAX_POLL_OPTION_LENGTH)]));
  });
  test("the same choice twice is refused, whatever the width or case", () => {
    assert.equal(normalizePollOptions(["Yes", "yes"]), null);
    assert.equal(normalizePollOptions(["ＡＢＣ", "abc"]), null);
  });
  test("anything but a list of strings is refused", () => {
    for (const raw of [null, undefined, "a,b", { 0: "a", 1: "b", length: 2 }, ["a", 1], ["a", null]]) {
      assert.equal(normalizePollOptions(raw), null, JSON.stringify(raw));
    }
  });
});

describe("poll votes", () => {
  test("indexes of the choices, each once, in order", () => {
    assert.deepEqual(normalizePollVote([2, 0, 2], 3, true), [0, 2]);
    assert.deepEqual(normalizePollVote([1], 3, false), [1]);
  });
  test("none takes the vote back", () => {
    assert.deepEqual(normalizePollVote([], 3, false), []);
  });
  test("more than one in a poll that takes one is refused", () => {
    assert.equal(normalizePollVote([0, 1], 3, false), null);
    // The same one twice is still one.
    assert.deepEqual(normalizePollVote([1, 1], 3, false), [1]);
  });
  test("an index that isn't a choice is refused", () => {
    for (const raw of [[3], [-1], [0.5], ["0"], [Number.NaN], [null]]) {
      assert.equal(normalizePollVote(raw, 3, true), null, JSON.stringify(raw));
    }
    assert.equal(normalizePollVote("0", 3, true), null);
  });
});
