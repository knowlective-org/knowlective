import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Y from "yjs";
import { MAX_COORD, MAX_SIZE, MIN_SIZE, copyWhiteboard, readItems, whiteboardMap, whiteboardText } from "../src/lib/whiteboard";
import {
  connectorPoints,
  crossing,
  edgePoint,
  ellipsePort,
  fitCamera,
  hopCrossings,
  hopPath,
  midpointOf,
  routePath,
  sideToward,
  snapAngle,
  stepZoom,
  straightened,
  toScreen,
  toWorld,
  zoomAt,
} from "../src/components/whiteboard/geometry";

// A whiteboard page's items (lib/whiteboard.ts). The document is shared by
// everyone who can edit the page, so whatever is in it is checked first.
//   pnpm --filter web test:unit

function board(items: Record<string, Record<string, unknown>>): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [id, fields] of Object.entries(items)) {
      const item = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(fields)) item.set(key, value);
      whiteboardMap(doc).set(id, item);
    }
  });
  return doc;
}

describe("whiteboard items", () => {
  test("malformed items are left out or brought into range", () => {
    const doc = board({
      a: { type: "sticky", x: 1e12, y: Number.NaN, w: 1e9, h: -5, text: 42, color: "chartreuse", z: 1 },
      b: { type: "script", x: 0, y: 0, w: 10, h: 10 },
      c: { type: "connector", from: "a", to: "a" },
    });
    const items = readItems(doc);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      id: "a",
      type: "sticky",
      x: MAX_COORD,
      y: 0,
      w: MAX_SIZE,
      h: MIN_SIZE,
      text: "",
      textX: 0,
      textY: 0,
      color: "yellow",
      z: 1,
      src: "",
      link: "",
      connectorEnds: "spread",
    });
  });

  test("a connector's arrowheads: those it has, or at the end when missing or unknown", () => {
    const doc = board({
      a: { type: "rect", x: 0, y: 0, w: 100, h: 50 },
      b: { type: "rect", x: 300, y: 0, w: 100, h: 50 },
      c: { type: "connector", from: "a", to: "b", arrows: "both", z: 1 },
      d: { type: "connector", from: "b", to: "a", z: 2 },
      e: { type: "connector", from: "a", to: "b", arrows: "sideways", z: 3 },
    });
    assert.deepEqual(
      readItems(doc).flatMap((i) => (i.type === "connector" ? [i.arrows] : [])),
      ["both", "end", "end"],
    );
  });

  test("lines and a connector's route: read with their defaults when missing or unknown", () => {
    const doc = board({
      a: { type: "rect", x: 0, y: 0, w: 100, h: 50 },
      b: { type: "rect", x: 300, y: 0, w: 100, h: 50 },
      c: { type: "connector", from: "a", to: "b", route: "elbow", z: 1 },
      d: { type: "connector", from: "b", to: "a", route: "zigzag", z: 2 },
      l: { type: "line", x1: 0, y1: 0, x2: 1e12, y2: "far", text: "ignored", z: 3 },
    });
    const items = readItems(doc);
    assert.deepEqual(
      items.flatMap((i) => (i.type === "connector" ? [i.route] : [])),
      ["elbow", "straight"],
    );
    assert.deepEqual(
      items.find((i) => i.type === "line"),
      { id: "l", type: "line", x1: 0, y1: 0, x2: MAX_COORD, y2: 0, arrows: "none", stroke: "solid", text: "", color: "gray", z: 3 },
    );
  });

  test("a connector shows only while both its ends are there", () => {
    const doc = board({
      a: { type: "rect", x: 0, y: 0, w: 100, h: 50, z: 1 },
      b: { type: "rect", x: 300, y: 0, w: 100, h: 50, z: 2 },
      c: { type: "connector", from: "a", to: "b", z: 3 },
      d: { type: "connector", from: "a", to: "gone", z: 4 },
    });
    assert.deepEqual(
      readItems(doc).map((i) => i.id),
      ["a", "b", "c"],
    );
  });

  test("the text for search runs top to bottom, then left to right", () => {
    const doc = board({
      a: { type: "sticky", x: 300, y: 0, w: 100, h: 100, text: "右上" },
      b: { type: "sticky", x: 0, y: 0, w: 100, h: 100, text: "左上" },
      c: { type: "text", x: 0, y: 500, w: 100, h: 40, text: "下\n  二行目" },
      d: { type: "connector", from: "a", to: "b", text: "矢印" },
    });
    assert.equal(whiteboardText(doc), "左上\n右上\n下 二行目\n矢印");
  });

  test("a copy holds the board as it is now, with its text changed on the way", () => {
    const source = board({ a: { type: "sticky", x: 0, y: 0, w: 100, h: 100, text: "secret 123", color: "pink" } });
    whiteboardMap(source).get("a")!.set("text", "secret 456");
    const target = board({ old: { type: "rect", x: 0, y: 0, w: 10, h: 10 } });
    target.transact(() => copyWhiteboard(source, target, (s) => s.replace("secret", "***")));
    assert.deepEqual(
      readItems(target).map((i) => [i.id, i.text, i.color]),
      [["a", "*** 456", "pink"]],
    );
  });
});

const AUTO = { from: null, to: null };

describe("whiteboard geometry", () => {
  test("zooming keeps the point under the pointer in place", () => {
    const camera = { x: 40, y: -20, zoom: 1 };
    const anchor = { x: 300, y: 200 };
    const before = toWorld(camera, anchor);
    const after = zoomAt(camera, anchor, 2.5);
    assert.equal(after.zoom, 2.5);
    assert.deepEqual(toScreen(after, before), anchor);
  });

  test("fitting never zooms in past 100% and centers the board", () => {
    const camera = fitCamera({ x: 0, y: 0, w: 100, h: 100 }, 1000, 800);
    assert.equal(camera.zoom, 1);
    assert.deepEqual(toScreen(camera, { x: 50, y: 50 }), { x: 500, y: 400 });
  });

  test("a connector starts at the edge of its box", () => {
    const box = { id: "a", type: "rect" as const, x: 0, y: 0, w: 100, h: 50, text: "", textX: 0, textY: 0, color: "white" as const, z: 0, src: "", link: "", connectorEnds: "spread" as const };
    assert.deepEqual(edgePoint(box, { x: 500, y: 25 }, 0), { x: 100, y: 25 });
    // A diamond: its point.
    assert.deepEqual(edgePoint({ ...box, type: "diamond" as const }, { x: 500, y: 25 }, 0), { x: 100, y: 25 });
    // Halfway between its points, the outline is halfway in.
    const d = edgePoint({ ...box, type: "diamond" as const }, { x: 50 + 50, y: 25 + 25 }, 0);
    assert.ok(Math.abs(d.x - 75) < 1e-9 && Math.abs(d.y - 37.5) < 1e-9);
    const ellipse = { ...box, type: "ellipse" as const };
    const p = edgePoint(ellipse, { x: 50, y: 500 }, 0);
    assert.deepEqual(p, { x: 50, y: 50 });
  });

  test("crossing lines meet where expected; lines that only touch or run side by side don't", () => {
    assert.equal(crossing({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 25, y: -10 }, { x: 25, y: 10 }), 0.25);
    assert.equal(crossing({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 5 }, { x: 100, y: 5 }), null);
    assert.equal(crossing({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }), null);
    assert.equal(crossing({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 1 }, { x: 50, y: 50 }), null);
  });

  test("a line hops over each crossing with a half circle, upward, skipping hops at its ends", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    assert.equal(hopPath(a, b, []), "M 0 0 L 100 0");
    assert.equal(hopPath(a, b, [0.5], 10), "M 0 0 L 40 0 A 10 10 0 0 1 60 0 L 100 0");
    // Going left, the other sweep keeps the hop on top.
    assert.equal(hopPath(b, a, [0.5], 10), "M 100 0 L 60 0 A 10 10 0 0 0 40 0 L 0 0");
    // Too close to an end, or to the hop before.
    assert.equal(hopPath(a, b, [0.05, 0.5, 0.55], 10), "M 0 0 L 40 0 A 10 10 0 0 1 60 0 L 100 0");
  });

  test("the zoom buttons stop at fixed steps, 100% among them, from wherever the zoom is", () => {
    assert.equal(stepZoom(1, 1), 1.25);
    assert.equal(stepZoom(1, -1), 0.75);
    assert.equal(stepZoom(0.93, 1), 1);
    assert.equal(stepZoom(1.07, -1), 1);
    assert.equal(stepZoom(4, 1), 4);
    assert.equal(stepZoom(0.1, -1), 0.1);
  });

  test("connectors on top of each other (the same two boxes, either way) hop as one line", () => {
    // A and B lie on the same segment, B in front; C crosses them, between the two.
    const lines = [
      { pair: "x y", points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
      { pair: "c d", points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
      { pair: "x y", points: [{ x: 100, y: 50 }, { x: 0, y: 50 }] },
    ];
    // Only the pair (as its front line) hops; C, below it, doesn't.
    assert.deepEqual(hopCrossings(lines), [[[0.5]], [[]], [[0.5]]]);
  });

  test("an elbow connector turns as few times as it can, never through a box", () => {
    const box = (id: string, x: number, y: number) => ({ id, type: "rect" as const, x, y, w: 100, h: 50, text: "", textX: 0, textY: 0, color: "white" as const, z: 0, src: "", link: "", connectorEnds: "spread" as const });
    // Diagonally apart, further across: across first, then down into the top (one turn).
    assert.deepEqual(connectorPoints(box("a", 0, 0), box("b", 300, 200), "elbow", AUTO, 0), [
      { x: 100, y: 25 },
      { x: 350, y: 25 },
      { x: 350, y: 200 },
    ]);
    // Further down than across: down first, then into the side.
    assert.deepEqual(connectorPoints(box("a", 0, 0), box("b", 150, 300), "elbow", AUTO, 0), [
      { x: 50, y: 50 },
      { x: 50, y: 325 },
      { x: 150, y: 325 },
    ]);
    // Sharing a band down (not lined up): no turn, through the middle of the band.
    assert.deepEqual(connectorPoints(box("a", 0, 0), box("b", 60, 300), "elbow", AUTO, 0), [
      { x: 80, y: 50 },
      { x: 80, y: 300 },
    ]);
    // Side by side, a little lower: no turn either.
    assert.deepEqual(connectorPoints(box("a", 0, 0), box("b", 300, 30), "elbow", AUTO, 0), [
      { x: 100, y: 40 },
      { x: 300, y: 40 },
    ]);
    // A band holding the first box's center line: along that line.
    const tall = (id: string, x: number, y: number) => ({ ...box(id, x, y), h: 100 });
    assert.deepEqual(connectorPoints(tall("a", 0, 0), tall("b", 300, 40), "elbow", AUTO, 0), [
      { x: 100, y: 50 },
      { x: 300, y: 50 },
    ]);
    // Overlapping boxes: two turns, between the facing sides.
    assert.equal(connectorPoints(box("a", 0, 0), box("b", 80, 20), "elbow", AUTO, 0).length, 4);
  });

  test("an elbow connector runs from and to the sides its ends were dropped on", () => {
    const box = (id: string, x: number, y: number) => ({ id, type: "rect" as const, x, y, w: 100, h: 50, text: "", textX: 0, textY: 0, color: "white" as const, z: 0, src: "", link: "", connectorEnds: "spread" as const });
    // Dropped on the top: around and in from above (one turn, across first).
    assert.deepEqual(connectorPoints(box("a", 0, 0), box("b", 300, 200), "elbow", { from: null, to: "top" }, 0), [
      { x: 100, y: 25 },
      { x: 350, y: 25 },
      { x: 350, y: 200 },
    ]);
    // Dropped on the left: in from the side; the start side is picked for the fewest turns.
    assert.deepEqual(connectorPoints(box("a", 0, 0), box("b", 300, 200), "elbow", { from: null, to: "left" }, 0), [
      { x: 50, y: 50 },
      { x: 50, y: 225 },
      { x: 300, y: 225 },
    ]);
    // Both sides the same way out: past both, and back (two turns).
    assert.deepEqual(connectorPoints(box("a", 0, 0), box("b", 300, 200), "elbow", { from: "top", to: "top" }, 0), [
      { x: 50, y: 0 },
      { x: 50, y: -24 },
      { x: 350, y: -24 },
      { x: 350, y: 200 },
    ]);
  });

  test("a diamond is connected at its corners only", () => {
    const box = (id: string, x: number, y: number) => ({ id, type: "rect" as const, x, y, w: 100, h: 50, text: "", textX: 0, textY: 0, color: "white" as const, z: 0, src: "", link: "", connectorEnds: "spread" as const });
    const diamond = (id: string, x: number, y: number) => ({ ...box(id, x, y), type: "diamond" as const });
    // Straight: from the corner facing the other box (for its shape: a box
    // 300 across and 200 down from a diamond 100 × 50 lies more below it).
    assert.deepEqual(connectorPoints(diamond("a", 0, 0), box("b", 300, 200), "straight", AUTO, 0)[0], { x: 50, y: 50 });
    assert.deepEqual(connectorPoints(diamond("a", 0, 0), box("b", 400, 40), "straight", AUTO, 0)[0], { x: 100, y: 25 });
    // Both diamonds: corner to corner.
    assert.deepEqual(connectorPoints(diamond("a", 0, 0), diamond("b", 60, 300), "straight", AUTO, 0), [
      { x: 50, y: 50 },
      { x: 110, y: 300 },
    ]);
    // Elbow, sharing a band (a rectangle would be joined straight across off
    // its corner): from its right corner instead, turning down.
    const corners = [
      { x: 100, y: 25 },
      { x: 50, y: 50 },
      { x: 50, y: 0 },
      { x: 0, y: 25 },
    ];
    const run = connectorPoints(diamond("a", 0, 0), box("b", 300, 30), "elbow", AUTO, 0);
    assert.ok(corners.some((c) => c.x === run[0].x && c.y === run[0].y));
  });

  test("an ellipse is connected at its points at 45° steps only", () => {
    const box = (id: string, x: number, y: number) => ({ id, type: "rect" as const, x, y, w: 100, h: 100, text: "", textX: 0, textY: 0, color: "white" as const, z: 0, src: "", link: "", connectorEnds: "spread" as const });
    const ellipse = (id: string, x: number, y: number) => ({ ...box(id, x, y), type: "ellipse" as const });
    const r = 50 * Math.SQRT1_2;
    // Toward 30° (below the right, y down): the point at 45°.
    const at30 = ellipsePort(ellipse("a", 0, 0), { x: 50 + 100 * Math.cos(Math.PI / 6), y: 50 + 100 * Math.sin(Math.PI / 6) }, 0);
    assert.ok(Math.abs(at30.x - (50 + r)) < 1e-6 && Math.abs(at30.y - (50 + r)) < 1e-6, JSON.stringify(at30));
    // Toward 10°: the point at 0°.
    assert.deepEqual(ellipsePort(ellipse("a", 0, 0), { x: 150, y: 50 + 100 * Math.tan(Math.PI / 18) }, 0), { x: 100, y: 50 });
    // Stretched: the steps are those of the circle it's stretched from (the
    // bounding box's corners' directions at 45°).
    const wide = { ...ellipse("a", 0, 0), w: 200 };
    const corner = ellipsePort(wide, { x: 200, y: 100 }, 0);
    assert.ok(Math.abs(corner.x - (100 + 100 * Math.SQRT1_2)) < 1e-6 && Math.abs(corner.y - (50 + r)) < 1e-6, JSON.stringify(corner));
    // The gap is outward, away from the center.
    assert.deepEqual(ellipsePort(ellipse("a", 0, 0), { x: 500, y: 50 }, 4), { x: 104, y: 50 });
    // A straight connector: from that point, to the other box's edge facing it.
    const [a, b] = connectorPoints(ellipse("a", 0, 0), box("b", 300, 300), "straight", AUTO, 0);
    assert.ok(Math.abs(a.x - (50 + r)) < 1e-6 && Math.abs(a.y - (50 + r)) < 1e-6, JSON.stringify(a));
    assert.ok(Math.abs(b.x - 300) < 1e-6 && Math.abs(b.y - 300) < 1e-6, JSON.stringify(b));
    // A box a little off the diagonal (about 18°): from the point at 0°.
    assert.deepEqual(connectorPoints(ellipse("a", 0, 0), box("b", 300, 120), "straight", AUTO, 0)[0], { x: 100, y: 50 });
    // Elbow: from the middle of a side around it (0°, 90°…).
    const sides = [
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 50, y: 0 },
      { x: 0, y: 50 },
    ];
    const run = connectorPoints(ellipse("a", 0, 0), box("b", 300, 30), "elbow", AUTO, 0);
    assert.ok(sides.some((c) => c.x === run[0].x && c.y === run[0].y), JSON.stringify(run[0]));
  });

  test("where an end is dropped on a box: the side it's toward, or none in the middle", () => {
    const box = { id: "a", type: "rect" as const, x: 0, y: 0, w: 200, h: 100, text: "", textX: 0, textY: 0, color: "white" as const, z: 0, src: "", link: "", connectorEnds: "spread" as const };
    assert.equal(sideToward(box, { x: 100, y: 50 }), null);
    assert.equal(sideToward(box, { x: 100, y: 5 }), "top");
    assert.equal(sideToward(box, { x: 195, y: 50 }), "right");
    assert.equal(sideToward(box, { x: 100, y: 130 }), "bottom");
    assert.equal(sideToward(box, { x: -20, y: 40 }), "left");
  });

  test("a line straightened: level or upright, whichever is nearer, about its middle", () => {
    const line = { id: "l", type: "line" as const, x1: 0, y1: 0, x2: 100, y2: 20, arrows: "none" as const, stroke: "solid" as const, text: "", color: "gray" as const, z: 0 };
    const level = straightened(line);
    assert.equal(level.y1, 10);
    assert.equal(level.y2, 10);
    assert.ok(Math.abs(level.x2 - level.x1 - Math.hypot(100, 20)) < 1e-9);
    assert.equal((level.x1 + level.x2) / 2, 50);
    const upright = straightened({ ...line, x2: -20, y2: -100 });
    assert.equal(upright.x1, -10);
    assert.equal(upright.x2, -10);
    assert.ok(upright.y2 < upright.y1);
  });

  test("corners are rounded, and hops stay off them", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    assert.equal(routePath(points, [[], []], 14, 10), "M 0 0 L 90 0 Q 100 0 100 10 L 100 100");
    // A crossing right at the corner: no hop there.
    assert.equal(routePath(points, [[0.95], []], 14, 10), "M 0 0 L 90 0 Q 100 0 100 10 L 100 100");
    assert.equal(routePath(points, [[0.5], []], 10, 10), "M 0 0 L 40 0 A 10 10 0 0 1 60 0 L 90 0 Q 100 0 100 10 L 100 100");
  });

  test("Shift snaps a line to 45° steps; a label sits halfway along a run", () => {
    const level = snapAngle({ x: 0, y: 0 }, { x: 100, y: 8 });
    assert.equal(level.y, 0);
    assert.ok(Math.abs(level.x - Math.hypot(100, 8)) < 1e-5);
    const diagonal = snapAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    assert.ok(Math.abs(diagonal.x - diagonal.y) < 1e-6);
    assert.deepEqual(
      midpointOf([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
      { x: 100, y: 0 },
    );
  });
});
