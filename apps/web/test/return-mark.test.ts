import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { markFor, readMark, RETURN_MARK_MAX_AGE_MS, screenOf } from "../src/lib/return-mark";

// The link last followed from a screen, pointed at again on coming back.
//   pnpm --filter web test:unit

const now = 1_800_000_000_000;
const saved = (mark: Record<string, unknown>) => JSON.stringify({ from: "/pages/list", to: "/pages/child", n: 0, at: now - 1000, ...mark });

describe("return marks", () => {
  test("a mark is shown on the screen it was left from", () => {
    assert.deepEqual(markFor(saved({}), "/pages/list", now), { from: "/pages/list", to: "/pages/child", n: 0, at: now - 1000 });
  });

  test("not on another screen, nor for a jump within the screen", () => {
    assert.equal(markFor(saved({}), "/pages/child", now), null);
    assert.equal(markFor(saved({ to: "/pages/list#h1" }), "/pages/list", now), null);
    assert.equal(screenOf("/search?q=a#x"), "/search?q=a");
  });

  test("an old mark is forgotten", () => {
    assert.equal(markFor(saved({ at: now - RETURN_MARK_MAX_AGE_MS - 1 }), "/pages/list", now), null);
    assert.equal(markFor(saved({ at: now + 3_600_000 }), "/pages/list", now), null);
  });

  test("anything else in storage is ignored", () => {
    for (const bad of [null, 1, "", "{", "null", "[]", saved({ n: -1 }), saved({ n: 1.5 }), saved({ from: "https://evil.example/" }), saved({ to: 3 }), saved({ at: "x" })]) {
      assert.equal(readMark(bad), null, String(bad));
    }
  });
});
