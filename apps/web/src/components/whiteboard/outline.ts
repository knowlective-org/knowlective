import { type Border, hexagonInset } from "@/lib/whiteboard";
import { STROKE_DRAW } from "./stroke";

// A box's outline as shapes in the box's own coordinates, on screen and in the
// export. It stays inside the box. A double outline is two real lines, so
// what's behind the box shows between them. No DOM (test/whiteboard-outline.test.ts).

type Paint = { width: number; dash?: string };
export type OutlineShape =
  | (Paint & { kind: "rect"; x: number; y: number; w: number; h: number; rx: number })
  | (Paint & { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number })
  | (Paint & { kind: "polygon"; points: string });

type P = [number, number];

// A convex polygon (clockwise on screen) with each side moved in by `by`.
export function insetPolygon(points: P[], by: number): P[] {
  const n = points.length;
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const length = Math.hypot(dx, dy) || 1;
    // The side's inward normal.
    const nx = -dy / length;
    const ny = dx / length;
    return { a: nx, b: ny, c: nx * p[0] + ny * p[1] + by };
  });
  return points.map((p, i) => {
    const l1 = lines[(i + n - 1) % n];
    const l2 = lines[i];
    const det = l1.a * l2.b - l2.a * l1.b;
    if (Math.abs(det) < 1e-9) return p;
    return [(l1.c * l2.b - l2.c * l1.b) / det, (l1.a * l2.c - l2.a * l1.c) / det];
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

function shapeAt(type: string, w: number, h: number, inset: number, paint: Paint): OutlineShape {
  if (type === "ellipse") {
    return { ...paint, kind: "ellipse", cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset) };
  }
  if (type === "diamond" || type === "hexagon") {
    const side = hexagonInset(h);
    const corners: P[] =
      type === "diamond"
        ? [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]
        : [[side, 0], [w - side, 0], [w, h / 2], [w - side, h], [side, h], [0, h / 2]];
    return { ...paint, kind: "polygon", points: insetPolygon(corners, inset).map(([x, y]) => `${round(x)},${round(y)}`).join(" ") };
  }
  return {
    ...paint,
    kind: "rect",
    x: inset,
    y: inset,
    w: Math.max(0, w - inset * 2),
    h: Math.max(0, h - inset * 2),
    rx: type === "rect" ? Math.max(0, 6 - inset) : 0,
  };
}

export function boxOutlines(type: string, w: number, h: number, border: Border): OutlineShape[] {
  if (border === "none") return [];
  const draw = STROKE_DRAW[border];
  if (border === "double") {
    return [shapeAt(type, w, h, 1, { width: 2 }), shapeAt(type, w, h, 5, { width: 2 })];
  }
  return [shapeAt(type, w, h, draw.width / 2, { width: draw.width, dash: draw.dash })];
}
