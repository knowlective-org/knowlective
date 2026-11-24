import assert from "node:assert/strict";
import { test } from "node:test";
import { snapAngle } from "../src/components/whiteboard/geometry";

const angleOf = (p: { x: number; y: number }, from: { x: number; y: number }) =>
  (Math.atan2(p.y - from.y, p.x - from.x) * 180) / Math.PI;

test("a line held with Shift turns to the nearest 15°, keeping its length", () => {
  const from = { x: 100, y: 50 };
  for (const [degrees, expected] of [
    [3, 0],
    [8, 15],
    [22, 15],
    [23, 30],
    [44, 45],
    [-52, -45],
    [97, 90],
    [172, 165],
  ]) {
    const radians = (degrees * Math.PI) / 180;
    const to = { x: from.x + Math.cos(radians) * 200, y: from.y + Math.sin(radians) * 200 };
    const snapped = snapAngle(from, to);
    assert.ok(Math.abs(angleOf(snapped, from) - expected) < 1e-3, `${degrees}° should snap to ${expected}°`);
    assert.ok(Math.abs(Math.hypot(snapped.x - from.x, snapped.y - from.y) - 200) < 1e-3);
  }
});

test("a level or upright line stays exactly so", () => {
  const from = { x: 10, y: 20 };
  assert.equal(snapAngle(from, { x: 310, y: 25 }).y, 20);
  assert.equal(snapAngle(from, { x: 12, y: 220 }).x, 10);
});
