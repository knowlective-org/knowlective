import assert from "node:assert/strict";
import { test } from "node:test";
import { scaleFactor, scaledFrom, snapAngle } from "../src/components/whiteboard/geometry";
import { MAX_SIZE, MIN_SIZE } from "../src/lib/whiteboard";

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

test("items resized together keep their proportions, by the farther of the pointer's two directions", () => {
  const bounds = { x: 100, y: 100, w: 200, h: 100 };
  const sizes = [{ w: 100, h: 50 }, { w: 80, h: 80 }];
  // Twice as wide; the height follows.
  assert.equal(scaleFactor(bounds, { x: 500, y: 150 }, sizes), 2);
  // Further down than across: the height decides.
  assert.equal(scaleFactor(bounds, { x: 200, y: 400 }, sizes), 3);
  // Half the size.
  assert.equal(scaleFactor(bounds, { x: 200, y: 150 }, sizes), 0.5);
  // The top left stays; the rest moves away from it.
  assert.deepEqual(scaledFrom({ x: 100, y: 100 }, { x: 200, y: 150 }, 2), { x: 300, y: 200 });
});

test("no box is resized below the smallest or above the largest size, nor turned inside out", () => {
  const bounds = { x: 0, y: 0, w: 200, h: 100 };
  const sizes = [{ w: 40, h: 20 }];
  // Dragged past the top left: as small as the smallest box allows.
  assert.equal(scaleFactor(bounds, { x: -50, y: -50 }, sizes), MIN_SIZE / 20);
  assert.equal(scaleFactor(bounds, { x: 1e9, y: 0 }, sizes), MAX_SIZE / 40);
  // Lines only (no boxes): a level line has no height to go by.
  assert.equal(scaleFactor({ x: 0, y: 0, w: 100, h: 0 }, { x: 300, y: 0 }, []), 3);
});
