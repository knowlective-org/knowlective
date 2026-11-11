import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseByteRange } from "../src/lib/byte-range";

// Range requests for attachments (video in Safari needs 206 answers).
describe("parseByteRange", () => {
  test("the forms a browser sends", () => {
    assert.deepEqual(parseByteRange("bytes=0-", 1000), { start: 0, end: 999 });
    assert.deepEqual(parseByteRange("bytes=0-1", 1000), { start: 0, end: 1 });
    assert.deepEqual(parseByteRange("bytes=500-2000", 1000), { start: 500, end: 999 });
    assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
    assert.deepEqual(parseByteRange("bytes=-5000", 1000), { start: 0, end: 999 });
  });
  test("past the end is unsatisfiable", () => {
    assert.equal(parseByteRange("bytes=1000-", 1000), "unsatisfiable");
    assert.equal(parseByteRange("bytes=-0", 1000), "unsatisfiable");
    assert.equal(parseByteRange("bytes=0-", 0), "unsatisfiable");
  });
  test("anything else is served whole", () => {
    assert.equal(parseByteRange(null, 1000), null);
    assert.equal(parseByteRange("bytes=-", 1000), null);
    assert.equal(parseByteRange("bytes=5-1", 1000), null);
    assert.equal(parseByteRange("bytes=0-1,5-6", 1000), null);
    assert.equal(parseByteRange("items=0-1", 1000), null);
    assert.equal(parseByteRange("bytes=1e3-", 1000), null);
  });
});
