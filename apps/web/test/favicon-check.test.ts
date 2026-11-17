import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_FAVICON_BYTES, checkFavicon } from "../src/lib/favicon-check";

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => new TextEncoder().encode(s);
const typeOf = (b: Uint8Array) => {
  const r = checkFavicon(b);
  return "type" in r ? r.type : r.error;
};

describe("a knowledge root's favicon", () => {
  test("is a PNG, an ICO or a safe SVG, told by its bytes", () => {
    assert.equal(typeOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)), "image/png");
    assert.equal(typeOf(bytes(0, 0, 1, 0, 1, 0, 16, 16)), "image/x-icon");
    assert.equal(typeOf(text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/></svg>')), "image/svg+xml");
  });

  test("isn't anything else, whatever its name said", () => {
    assert.equal(typeOf(bytes()), "badType");
    assert.equal(typeOf(text("GIF89a")), "badType");
    assert.equal(typeOf(text("<html><body>hi</body></html>")), "badType");
    // A cursor file (type 2), and an ICO with no images.
    assert.equal(typeOf(bytes(0, 0, 2, 0, 1, 0)), "badType");
    assert.equal(typeOf(bytes(0, 0, 1, 0, 0, 0)), "badType");
    // A PNG signature cut short.
    assert.equal(typeOf(bytes(0x89, 0x50, 0x4e, 0x47)), "badType");
  });

  test("isn't an SVG that runs or reaches out", () => {
    assert.equal(typeOf(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), "unsafe");
    assert.equal(typeOf(text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), "unsafe");
    assert.equal(typeOf(text('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>')), "unsafe");
  });

  test("isn't too large", () => {
    const big = new Uint8Array(MAX_FAVICON_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(typeOf(big), "tooLarge");
  });
});
