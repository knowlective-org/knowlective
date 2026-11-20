import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_AVATAR_BYTES, avatarUrl, checkAvatar, initialOf } from "../src/lib/avatar-check";

const pad = (head: number[]) => Uint8Array.from([...head, ...new Array(32).fill(0)]);
const text = (s: string) => new TextEncoder().encode(s);

test("an avatar's type comes from its bytes", () => {
  assert.deepEqual(checkAvatar(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { type: "image/png" });
  assert.deepEqual(checkAvatar(pad([0xff, 0xd8, 0xff, 0xe0])), { type: "image/jpeg" });
  assert.deepEqual(checkAvatar(pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])), { type: "image/webp" });
});

test("anything else is turned down: SVG, GIF, HTML, a RIFF that isn't WebP, too small or too large", () => {
  assert.deepEqual(checkAvatar(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), { error: "badType" });
  assert.deepEqual(checkAvatar(text("GIF89a............")), { error: "badType" });
  assert.deepEqual(checkAvatar(text("<html><body>hi</body></html>")), { error: "badType" });
  assert.deepEqual(checkAvatar(pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])), { error: "badType" });
  assert.deepEqual(checkAvatar(Uint8Array.from([0xff, 0xd8, 0xff])), { error: "badType" });
  const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  assert.deepEqual(checkAvatar(big), { error: "tooLarge" });
});

test("a person's initial: the first whole character, upper-cased", () => {
  assert.equal(initialOf("alice"), "A");
  assert.equal(initialOf("  山田 太郎"), "山");
  assert.equal(initialOf("👩‍💻 dev"), "👩‍💻");
  assert.equal(initialOf("éclair"), "É");
  assert.equal(initialOf(""), "?");
  assert.equal(initialOf(null), "?");
});

test("an avatar's address carries the time it was set", () => {
  assert.equal(avatarUrl("u1", null), null);
  assert.equal(avatarUrl("u1", 123), "/api/users/u1/avatar?v=123");
  assert.equal(avatarUrl("u1", new Date(5)), "/api/users/u1/avatar?v=5");
});
