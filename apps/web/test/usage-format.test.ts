import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bytesUnit, niceTicks } from "../src/lib/usage-format";

// The usage dashboard's numbers (lib/usage-format.ts).
//   pnpm --filter web test:unit

describe("usage format", () => {
  test("bytes are shown in the largest unit under 1024", () => {
    assert.deepEqual(bytesUnit(0), { value: 0, unit: "B" });
    assert.deepEqual(bytesUnit(1023), { value: 1023, unit: "B" });
    assert.deepEqual(bytesUnit(1024), { value: 1, unit: "KB" });
    assert.deepEqual(bytesUnit(1536 * 1024), { value: 1.5, unit: "MB" });
    assert.deepEqual(bytesUnit(5 * 1024 ** 4), { value: 5, unit: "TB" });
    assert.deepEqual(bytesUnit(2048 * 1024 ** 4), { value: 2048, unit: "TB" });
    assert.deepEqual(bytesUnit(-5), { value: 0, unit: "B" });
  });

  test("the axis reaches the largest value in round steps", () => {
    assert.deepEqual(niceTicks(0), [0, 1]);
    assert.deepEqual(niceTicks(4), [0, 1, 2, 3, 4]);
    assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
    assert.deepEqual(niceTicks(100), [0, 50, 100]);
    assert.deepEqual(niceTicks(1234), [0, 500, 1000, 1500]);
    for (const max of [1, 3, 9, 11, 99, 101, 12345]) {
      const ticks = niceTicks(max);
      assert.ok(ticks.at(-1)! >= max, `top for ${max}`);
      assert.ok(ticks.length <= 6, `few ticks for ${max}`);
    }
  });
});
