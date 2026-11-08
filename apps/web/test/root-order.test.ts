import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeRootOrder, orderRoots } from "../src/lib/root-order";

// The order of knowledge roots in a sidebar (lib/root-order.ts).
//   pnpm --filter web test:unit

const roots = ["a", "b", "c", "d"].map((rootId) => ({ rootId })); // oldest first

describe("knowledge root order", () => {
  test("by default, newest first", () => {
    assert.deepEqual(orderRoots(roots, []).map((r) => r.rootId), ["d", "c", "b", "a"]);
  });

  test("the placed ones in their order, after the unplaced ones (newest first); unknown ids ignored", () => {
    assert.deepEqual(orderRoots(roots, ["b", "x", "a"]).map((r) => r.rootId), ["d", "c", "b", "a"]);
    assert.deepEqual(orderRoots(roots, ["a", "c", "b", "d"]).map((r) => r.rootId), ["a", "c", "b", "d"]);
    assert.deepEqual(orderRoots(roots, ["a", "b"]).map((r) => r.rootId), ["d", "c", "a", "b"]);
  });

  test("a saved order: ids only, each once, not too many", () => {
    assert.deepEqual(normalizeRootOrder(["a", "b", "a"]), ["a", "b"]);
    assert.equal(normalizeRootOrder(["a", "b c"]), null);
    assert.equal(normalizeRootOrder(["a", { id: "b" }]), null);
    assert.equal(normalizeRootOrder(["x"], 0), null);
  });
});
