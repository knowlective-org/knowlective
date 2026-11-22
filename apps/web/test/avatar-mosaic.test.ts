import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { avatarLook } from "../src/lib/avatar-check";
import { AVATAR_COLOR_PRESETS, isAvatarColor, mosaicBackground, mosaicShades, mosaicSvg } from "../src/lib/avatar-mosaic";

// The mosaic shown for people without a picture (lib/avatar-mosaic.ts).
//   pnpm --filter web test:unit

const fills = (svg: string) => [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);

const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return null;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe("avatar mosaic", () => {
  test("only colors written #rrggbb are kept", () => {
    for (const ok of ["#2f7d6d", "#000000", ...AVATAR_COLOR_PRESETS]) assert.ok(isAvatarColor(ok), ok);
    for (const bad of ["#2F7D6D", "#fff", "red", "#2f7d6d;", "url(x)", "#2f7d6d\" onload=\"x", null, 5]) assert.ok(!isAvatarColor(bad), String(bad));
    // Stored nonsense: the cursor's color instead (null).
    assert.deepEqual(avatarLook({ id: "u", avatarColor: "red", avatarSeed: 2 }), { url: null, color: null, seed: 2 });
    assert.deepEqual(avatarLook({ id: "u", avatarColor: "#1f5f8b" }), { url: null, color: "#1f5f8b", seed: 0 });
  });

  test("four shades of the color's hue, light to dark", () => {
    const shades = mosaicShades("#c0562b");
    assert.equal(shades.length, 4);
    const base = hue("#c0562b")!;
    for (const s of shades) assert.ok(Math.abs(hue(s)! - base) < 3, `${s}: ${hue(s)} vs ${base}`);
    const lightness = shades.map((s) => {
      const n = parseInt(s.slice(1), 16);
      return Math.max(n >> 16, (n >> 8) & 255, n & 255) + Math.min(n >> 16, (n >> 8) & 255, n & 255);
    });
    assert.deepEqual([...lightness].sort((a, b) => b - a), lightness);
    // A gray stays gray.
    for (const s of mosaicShades("#808080")) assert.equal(hue(s), null, s);
  });

  test("the same person and number: the same pattern; another number or person: another", () => {
    const a = mosaicSvg("user-1", 0, "#2f7d6d");
    assert.equal(mosaicSvg("user-1", 0, "#2f7d6d"), a);
    assert.notEqual(mosaicSvg("user-1", 1, "#2f7d6d"), a);
    assert.notEqual(mosaicSvg("user-2", 0, "#2f7d6d"), a);
    // A 4 × 4 grid of squares, each two triangles, in the color's shades only.
    const shades = new Set(mosaicShades("#2f7d6d"));
    const used = fills(a);
    assert.equal(used.length, 32);
    assert.ok(used.every((f) => shades.has(f)));
    assert.ok(new Set(used).size >= 2, "more than one shade");
    // Another color: the same pattern, in its shades.
    const other = mosaicShades("#6b4fa3");
    const index = (svg: string, list: string[]) => fills(svg).map((f) => list.indexOf(f));
    assert.deepEqual(index(mosaicSvg("user-1", 0, "#6b4fa3"), other), index(a, [...mosaicShades("#2f7d6d")]));
  });

  test("as a CSS background: the SVG, encoded", () => {
    const bg = mosaicBackground("user-1", 3, "#1f5f8b");
    assert.ok(bg.startsWith('url("data:image/svg+xml,'));
    assert.ok(!/["'()\s]/.test(bg.slice('url("data:image/svg+xml,'.length, -2)), "nothing that ends the url");
    assert.equal(decodeURIComponent(bg.slice('url("data:image/svg+xml,'.length, -2)), mosaicSvg("user-1", 3, "#1f5f8b"));
  });
});
