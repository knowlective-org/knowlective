import { type BoxItem, type LineItem, type Route, SIDES, type Side } from "@/lib/whiteboard";

// The view onto the board: a point at world (x, y) is drawn at
// (x * zoom + camera.x, y * zoom + camera.y) in the canvas.
export type Camera = { x: number; y: number; zoom: number };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

// Where the zoom buttons stop, so 100% is always one of them (scrolling and
// pinching zoom smoothly, between these).
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// The next step up (dir 1) or down (dir -1) from `zoom`, which may lie
// between steps.
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const eps = 0.001;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - eps) ?? MIN_ZOOM;
}

export function toWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom };
}

export function toScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y };
}

// Zooms to `zoom`, keeping the board point under `anchor` (canvas pixels) in place.
export function zoomAt(camera: Camera, anchor: Point, zoom: number): Camera {
  const next = clampZoom(zoom);
  const world = toWorld(camera, anchor);
  return { zoom: next, x: anchor.x - world.x * next, y: anchor.y - world.y * next };
}

// The smallest rectangle around the boxes, or null for none.
export function boundsOf(boxes: Rect[]): Rect | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// A camera showing all of `bounds` in a `width` × `height` canvas, at most at
// 100% (a small board isn't blown up).
export function fitCamera(bounds: Rect | null, width: number, height: number, padding = 48): Camera {
  if (!bounds) return { x: width / 2, y: height / 2, zoom: 1 };
  const zoom = clampZoom(
    Math.min(1, (width - padding * 2) / Math.max(bounds.w, 1), (height - padding * 2) / Math.max(bounds.h, 1)),
  );
  return {
    zoom,
    x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.h / 2) * zoom,
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// The rectangle between two corners, in any order.
export function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// Where the line from the box's center toward `toward` leaves the box's
// outline (an ellipse for ellipses, a diamond for diamonds), `gap` further out.
export function edgePoint(box: BoxItem, toward: Point, gap = 4): Point {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: cx, y: cy };
  const hw = box.w / 2;
  const hh = box.h / 2;
  const t =
    box.type === "ellipse"
      ? 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
      : box.type === "diamond"
        ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
        : Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  const along = Math.min(1, t + gap / len);
  return { x: cx + dx * along, y: cy + dy * along };
}

// Where a connector meets an ellipse: the one of the eight points round it
// at 45° steps (0° on the right, through the bounding box's corners'
// directions) nearest the direction of `toward`, `gap` further out.
export function ellipsePort(box: BoxItem, toward: Point, gap = 4): Point {
  const hw = box.w / 2;
  const hh = box.h / 2;
  const cx = box.x + hw;
  const cy = box.y + hh;
  const step = Math.PI / 4;
  // The direction on the circle the ellipse is stretched from.
  const angle = Math.round(Math.atan2((toward.y - cy) / hh, (toward.x - cx) / hw) / step) * step;
  const dx = hw * Math.cos(angle);
  const dy = hh * Math.sin(angle);
  const out = 1 + gap / Math.hypot(dx, dy);
  // Rounded off: cos and sin of the steps aren't exact.
  const round = (n: number) => Math.round(n * 1e9) / 1e9;
  return { x: round(cx + dx * out), y: round(cy + dy * out) };
}

export function center(box: Rect): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

// A connector's line between two boxes: from the edge of one to the edge of the other.
export function connectorLine(from: BoxItem, to: BoxItem): { a: Point; b: Point } {
  return { a: edgePoint(from, center(to)), b: edgePoint(to, center(from)) };
}

// A plain line's ends, and the rectangle around it.
export function lineEnds(line: LineItem): [Point, Point] {
  return [
    { x: line.x1, y: line.y1 },
    { x: line.x2, y: line.y2 },
  ];
}

export function lineRect(line: LineItem): Rect {
  return rectFrom(...lineEnds(line));
}

// The line turned level or upright, whichever it's closer to, about its
// middle and as long (double-clicking a line).
export function straightened(line: LineItem): Pick<LineItem, "x1" | "y1" | "x2" | "y2"> {
  const mx = (line.x1 + line.x2) / 2;
  const my = (line.y1 + line.y2) / 2;
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const half = Math.hypot(dx, dy) / 2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = dx < 0 ? -1 : 1;
    return { x1: mx - s * half, y1: my, x2: mx + s * half, y2: my };
  }
  const s = dy < 0 ? -1 : 1;
  return { x1: mx, y1: my - s * half, x2: mx, y2: my + s * half };
}

// `to` turned to the nearest multiple of 45° around `from`, as far away (Shift
// while drawing a line).
export function snapAngle(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.round(Math.cos(angle) * length * 1e6) / 1e6, y: from.y + Math.round(Math.sin(angle) * length * 1e6) / 1e6 };
}

const DIRECTIONS: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

// Where a connector leaves or enters a box's side: its middle, `gap` out,
// and the way out.
export function port(box: BoxItem, side: Side, gap = 4): { p: Point; d: Point } {
  const d = DIRECTIONS[side];
  return { p: { x: box.x + box.w / 2 + d.x * (box.w / 2 + gap), y: box.y + box.h / 2 + d.y * (box.h / 2 + gap) }, d };
}

// The side of the box a point is toward (inside or outside it), or null in
// its middle half (a connector's end dropped there routes itself).
export function sideToward(box: BoxItem, p: Point): Side | null {
  const rx = (p.x - (box.x + box.w / 2)) / (box.w / 2);
  const ry = (p.y - (box.y + box.h / 2)) / (box.h / 2);
  if (Math.max(Math.abs(rx), Math.abs(ry)) < 0.5) return null;
  if (Math.abs(rx) > Math.abs(ry)) return rx > 0 ? "right" : "left";
  return ry > 0 ? "bottom" : "top";
}

// The side of the box (around it) a point lies toward — for a diamond, the
// corner there.
export function sideFacing(box: BoxItem, p: Point): Side {
  const rx = (p.x - (box.x + box.w / 2)) / (box.w / 2);
  const ry = (p.y - (box.y + box.h / 2)) / (box.h / 2);
  if (Math.abs(rx) >= Math.abs(ry)) return rx >= 0 ? "right" : "left";
  return ry >= 0 ? "bottom" : "top";
}

// The points without repeats, nor points in the middle of a straight run.
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const before = out[out.length - 2];
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const minus = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });

// A run of right angles from p1 (leaving the way d1 points) to p2 (arriving
// against d2, the way out of its box), with as few turns as those allow:
// straight, one corner, two (halfway, or around past both), three, or four
// (going back around). `margin`: how far it clears a box before turning back.
export function orthoRoute(p1: Point, d1: Point, p2: Point, d2: Point, margin = 24): Point[] {
  const across1 = d1.x !== 0;
  const across2 = d2.x !== 0;
  const ahead = dot(minus(p2, p1), d1) > 0;
  if (across1 === across2) {
    const facing = d1.x === -d2.x && d1.y === -d2.y;
    if (facing && ahead) {
      if (across1 ? Math.abs(p1.y - p2.y) < 0.5 : Math.abs(p1.x - p2.x) < 0.5) return [p1, across1 ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y }];
      const mid = across1 ? (p1.x + p2.x) / 2 : (p1.y + p2.y) / 2;
      return simplify(across1 ? [p1, { x: mid, y: p1.y }, { x: mid, y: p2.y }, p2] : [p1, { x: p1.x, y: mid }, { x: p2.x, y: mid }, p2]);
    }
    if (!facing) {
      // The same way out: past whichever is further, and back.
      const far = across1
        ? d1.x > 0 ? Math.max(p1.x, p2.x) + margin : Math.min(p1.x, p2.x) - margin
        : d1.y > 0 ? Math.max(p1.y, p2.y) + margin : Math.min(p1.y, p2.y) - margin;
      return simplify(across1 ? [p1, { x: far, y: p1.y }, { x: far, y: p2.y }, p2] : [p1, { x: p1.x, y: far }, { x: p2.x, y: far }, p2]);
    }
    // Facing, but behind each other: out of both, and across between them.
    const q1 = { x: p1.x + d1.x * margin, y: p1.y + d1.y * margin };
    const q2 = { x: p2.x + d2.x * margin, y: p2.y + d2.y * margin };
    const mid = across1 ? (p1.y + p2.y) / 2 : (p1.x + p2.x) / 2;
    return simplify(
      across1
        ? [p1, q1, { x: q1.x, y: mid }, { x: q2.x, y: mid }, q2, p2]
        : [p1, q1, { x: mid, y: q1.y }, { x: mid, y: q2.y }, q2, p2],
    );
  }
  // At right angles: one corner, if it lies ahead of both ends.
  const corner = across1 ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
  if (dot(minus(corner, p1), d1) > 0 && dot(minus(corner, p2), d2) > 0) return [p1, corner, p2];
  // Else out of both, and one corner between.
  const q1 = { x: p1.x + d1.x * margin, y: p1.y + d1.y * margin };
  const q2 = { x: p2.x + d2.x * margin, y: p2.y + d2.y * margin };
  return simplify([p1, q1, across1 ? { x: q1.x, y: q2.y } : { x: q2.x, y: q1.y }, q2, p2]);
}

const runLength = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

// The points a connector runs through. Straight: edge to edge, toward each
// other's centers (a diamond: from its corner facing the other; an ellipse:
// from the point at 45° steps facing it, ellipsePort()). An ellipse, like a
// diamond, takes an elbow at the middles of the sides around it only. Elbow with sides chosen (where its ends were dropped):
// from and to those sides, the other one (if only one is chosen) taken to
// make the fewest turns, then the shortest run (orthoRoute). Elbow with
// neither chosen: as few turns as it takes, never through either box —
//   none: the boxes share a band across (or down): one run along it, at
//     the first box's center line if that's in the band (so connectors out
//     of the same side leave together), else the other's, else its middle;
//   one: out of a side of one box, turning into the top or bottom (or a
//     side) of the other, at both centers' lines (across first when the boxes
//     are further apart across than down);
//   two: out of the facing sides, turning halfway (boxes that overlap).
export function connectorPoints(
  from: BoxItem,
  to: BoxItem,
  route: Route,
  sides: { from: Side | null; to: Side | null } = { from: null, to: null },
  gap = 4,
): Point[] {
  if (route === "straight") {
    // A diamond is connected at its corners only, an ellipse at its points at
    // 45° steps: the one facing the other box (and the other box's edge
    // faces that point).
    const fixed = (box: BoxItem) => box.type === "diamond" || box.type === "ellipse";
    if (!fixed(from) && !fixed(to)) {
      const { a, b } = connectorLine(from, to);
      return [a, b];
    }
    const meet = (box: BoxItem, p: Point) =>
      box.type === "diamond" ? port(box, sideFacing(box, p), gap).p : box.type === "ellipse" ? ellipsePort(box, p, gap) : edgePoint(box, p, gap);
    const b0 = fixed(to) ? meet(to, center(from)) : null;
    const a = meet(from, b0 ?? center(to));
    const b = b0 ?? meet(to, a);
    return [a, b];
  }
  // Sides chosen, or a diamond or an ellipse (its corners, or its points at
  // 0°, 90°…, are the middles of the sides around it): the best of the
  // sides that may be used.
  const sidesOnly = (box: BoxItem) => box.type === "diamond" || box.type === "ellipse";
  if (sides.from || sides.to || sidesOnly(from) || sidesOnly(to)) {
    let best: Point[] | null = null;
    for (const s1 of sides.from ? [sides.from] : SIDES) {
      for (const s2 of sides.to ? [sides.to] : SIDES) {
        const a = port(from, s1, gap);
        const b = port(to, s2, gap);
        const points = orthoRoute(a.p, a.d, b.p, b.d);
        if (!best || points.length < best.length || (points.length === best.length && runLength(points) < runLength(best))) best = points;
      }
    }
    return best!;
  }
  const a = center(from);
  const b = center(to);
  const right = b.x >= a.x;
  const down = b.y >= a.y;
  // Edge to edge across (at height y), or down (at x).
  const across = (y: number) => [
    { x: right ? from.x + from.w + gap : from.x - gap, y },
    { x: right ? to.x - gap : to.x + to.w + gap, y },
  ];
  const upDown = (x: number) => [
    { x, y: down ? from.y + from.h + gap : from.y - gap },
    { x, y: down ? to.y - gap : to.y + to.h + gap },
  ];
  const apartAcross = right ? to.x >= from.x + from.w + gap * 2 : to.x + to.w + gap * 2 <= from.x;
  const apartDown = down ? to.y >= from.y + from.h + gap * 2 : to.y + to.h + gap * 2 <= from.y;
  const widerApart = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

  // No turn.
  const bandTop = Math.max(from.y, to.y);
  const bandBottom = Math.min(from.y + from.h, to.y + to.h);
  const bandLeft = Math.max(from.x, to.x);
  const bandRight = Math.min(from.x + from.w, to.x + to.w);
  const inBand = (lo: number, hi: number, ...lines: number[]) => lines.find((v) => v > lo && v < hi) ?? (lo + hi) / 2;
  if (apartAcross && bandTop < bandBottom) return across(inBand(bandTop, bandBottom, a.y, b.y));
  if (apartDown && bandLeft < bandRight) return upDown(inBand(bandLeft, bandRight, a.x, b.x));

  // One turn: the corner lies outside both boxes when each center's line
  // misses the other box.
  const acrossFirst =
    (right ? b.x > from.x + from.w + gap : b.x < from.x - gap) && (down ? a.y < to.y - gap : a.y > to.y + to.h + gap)
      ? [
          { x: right ? from.x + from.w + gap : from.x - gap, y: a.y },
          { x: b.x, y: a.y },
          { x: b.x, y: down ? to.y - gap : to.y + to.h + gap },
        ]
      : null;
  const downFirst =
    (down ? b.y > from.y + from.h + gap : b.y < from.y - gap) && (right ? a.x < to.x - gap : a.x > to.x + to.w + gap)
      ? [
          { x: a.x, y: down ? from.y + from.h + gap : from.y - gap },
          { x: a.x, y: b.y },
          { x: right ? to.x - gap : to.x + to.w + gap, y: b.y },
        ]
      : null;
  const oneTurn = widerApart ? (acrossFirst ?? downFirst) : (downFirst ?? acrossFirst);
  if (oneTurn) return oneTurn;

  // Two turns, halfway between the facing sides.
  if (widerApart) {
    const [start, end] = [across(a.y)[0], { ...across(b.y)[1] }];
    const mid = (start.x + end.x) / 2;
    return [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end];
  }
  const [start, end] = [upDown(a.x)[0], { ...upDown(b.x)[1] }];
  const mid = (start.y + end.y) / 2;
  return [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
}

// How far apart the ends of connectors meeting a box at the same point are
// spread (less on a short side): about an arrowhead's width.
export const END_SPACING = 20;

// Connectors' points with the ends that meet a box at the same point spread
// along its side (across for the top and bottom, down for the left and
// right; for a diamond or an ellipse, the side around it there), in the
// order of where their other ends are, so they don't cross there. Not at
// boxes whose `connectorEnds` is "merge". An elbow's last run (straight
// out of the box) moves with its end; a run straight across to the other
// box gets a step halfway instead.
export function spreadEnds<T extends { from: string; to: string; points: Point[] }>(
  lines: T[],
  boxOf: (id: string) => BoxItem | undefined,
  spacing = END_SPACING,
): T[] {
  const groups = new Map<string, { line: number; end: 0 | 1; box: BoxItem }[]>();
  lines.forEach((l, line) => {
    if (l.points.length < 2) return;
    for (const end of [0, 1] as const) {
      const box = boxOf(end === 0 ? l.from : l.to);
      if (!box || box.connectorEnds === "merge") continue;
      const p = end === 0 ? l.points[0] : l.points[l.points.length - 1];
      const key = `${box.id} ${Math.round(p.x * 2)} ${Math.round(p.y * 2)}`;
      groups.set(key, [...(groups.get(key) ?? []), { line, end, box }]);
    }
  });
  const out = lines.map((l) => ({ ...l, points: [...l.points] }));
  for (const ends of groups.values()) {
    if (ends.length < 2) continue;
    const { box } = ends[0];
    const first = out[ends[0].line].points;
    const at = ends[0].end === 0 ? first[0] : first[first.length - 1];
    const side = sideFacing(box, at);
    const acrossX = side === "top" || side === "bottom";
    const length = acrossX ? box.w : box.h;
    const step = Math.min(spacing, length / (ends.length + 1));
    const coord = (p: Point) => (acrossX ? p.x : p.y);
    const otherEnd = (e: { line: number; end: 0 | 1 }) => {
      const pts = out[e.line].points;
      return e.end === 0 ? pts[pts.length - 1] : pts[0];
    };
    const sorted = [...ends].sort((a, b) => coord(otherEnd(a)) - coord(otherEnd(b)) || a.line - b.line);
    sorted.forEach((e, k) => {
      const offset = (k - (sorted.length - 1) / 2) * step;
      if (offset !== 0) out[e.line].points = shiftEnd(out[e.line].points, e.end, acrossX, offset);
    });
  }
  return out;
}

// The points with an end moved `offset` across (or down): with the run of
// points straight out of it, unless that run reaches the other end (then a
// step halfway along it).
function shiftEnd(points: Point[], end: 0 | 1, acrossX: boolean, offset: number): Point[] {
  const pts = end === 0 ? [...points] : [...points].reverse();
  const coord = (p: Point) => (acrossX ? p.x : p.y);
  const moved = (p: Point) => (acrossX ? { x: p.x + offset, y: p.y } : { x: p.x, y: p.y + offset });
  let last = 0;
  while (last + 1 < pts.length && Math.abs(coord(pts[last + 1]) - coord(pts[0])) < 0.01) last++;
  let result: Point[];
  if (last === 0) {
    // Not straight out (a straight connector at an angle): the end alone.
    result = [moved(pts[0]), ...pts.slice(1)];
  } else if (last === pts.length - 1) {
    // One straight run between the boxes: a step halfway along its first part.
    const a = pts[0];
    const b = pts[1];
    const mid = acrossX ? { x: a.x, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: a.y };
    result = [moved(a), moved(mid), mid, ...pts.slice(1)];
  } else {
    result = [...pts.slice(0, last + 1).map(moved), ...pts.slice(last + 1)];
  }
  return end === 0 ? result : result.reverse();
}

// The point `distance` along a run of points from its start (its end, if
// the run is shorter).
// How far from its end a connector's end label sits (past the arrowhead).
export const END_LABEL_DISTANCE = 32;

// Where an end's text sits (`run`: the connector's points from that end):
// beside the line, not on it — above a line running across ("above": the
// label's bottom center at the point), right of one running up or down
// ("right": its left middle at the point).
export function endLabelPlace(run: Point[]): { x: number; y: number; side: "above" | "right" } {
  const p = pointAlong(run, END_LABEL_DISTANCE);
  const q = pointAlong(run, END_LABEL_DISTANCE + 1);
  return Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? { x: p.x, y: p.y - 4, side: "above" } : { x: p.x + 6, y: p.y, side: "right" };
}

export function pointAlong(points: Point[], distance: number): Point {
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (left <= len && len > 0) {
      const t = left / len;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    left -= len;
  }
  return points[points.length - 1];
}

// How far along the run (0 to 1, by length) its nearest point to `p` lies.
export function fractionAlong(points: Point[], p: Point): number {
  let total = 0;
  let best = { distance: Infinity, at: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = len > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const distance = Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y);
    if (distance < best.distance) best = { distance, at: total + len * t };
    total += len;
  }
  return total > 0 ? best.at / total : 0;
}

// The point halfway along a run of points (where a connector's label goes).
export function midpointOf(points: Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((sum, l) => sum + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const t = left / lengths[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    left -= lengths[i];
  }
  return points[points.length - 1];
}

// Where segment a–b crosses segment c–d, as the distance along a–b (0 to 1),
// or null when they don't cross (or are parallel). Touching at an end doesn't count.
export function crossing(a: Point, b: Point, c: Point, d: Point): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  const eps = 1e-6;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps ? t : null;
}

export const HOP_RADIUS = 14;

// The rounding of an elbow connector's corners.
export const CORNER_RADIUS = 12;

const segmentsOf = (points: Point[]) => points.slice(1).map((p, i) => [points[i], p] as const);

// Where each line hops, for lines (runs of points) given back to front: for
// each of its segments, the crossing distances along it (0 to 1). Lines with
// the same `pair` (connectors between the same two boxes, either way round)
// lie on top of each other and look like one line, so they act as one,
// placed as their front one: a line hops over those of groups below its own,
// never over its own group's, and hops like the rest of its group — or two
// would hop at the same crossing, forming a circle.
export function hopCrossings(lines: { pair: string; points: Point[] }[]): number[][][] {
  const rank = new Map<string, number>();
  lines.forEach((line, i) => rank.set(line.pair, i));
  return lines.map((line) =>
    segmentsOf(line.points).map(([a, b]) =>
      lines.flatMap((other) => {
        if (rank.get(other.pair)! >= rank.get(line.pair)!) return [];
        return segmentsOf(other.points).flatMap(([c, d]) => {
          const t = crossing(a, b, c, d);
          return t === null ? [] : [t];
        });
      }),
    ),
  );
}

// An SVG path through the points, with rounded corners, hopping over the
// lines it crosses (`crossings`: per segment, distances along it from 0 to
// 1): a half circle at each, bulging upward on the screen (right for a
// segment going straight up or down). Hops that would touch a corner, an end
// or each other are left out.
export function routePath(points: Point[], crossings: number[][], radius = HOP_RADIUS, corner = CORNER_RADIUS): string {
  const length = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  const last = points.length - 1;
  // How much each corner takes off the segments on either side.
  const cut = points.map((p, i) => (i === 0 || i === last ? 0 : Math.min(corner, length(points[i - 1], p) / 2, length(p, points[i + 1]) / 2)));
  let d = `M ${points[0].x} ${points[0].y}`;
  segmentsOf(points).forEach(([a, b], k) => {
    const len = length(a, b);
    const at = (t: number) => `${a.x + (b.x - a.x) * t} ${a.y + (b.y - a.y) * t}`;
    const end = len > 0 ? 1 - cut[k + 1] / len : 1;
    if (len > 0) {
      const half = radius / len;
      // Clockwise (sweep 1) bulges up when going right on screen.
      const sweep = b.x > a.x || (b.x === a.x && b.y > a.y) ? 1 : 0;
      let done = cut[k] / len;
      for (const t of [...(crossings[k] ?? [])].sort((x, y) => x - y)) {
        if (t - half < done + half / 2 || t + half > end - half / 2) continue;
        d += ` L ${at(t - half)} A ${radius} ${radius} 0 0 ${sweep} ${at(t + half)}`;
        done = t + half;
      }
    }
    const next = points[k + 2];
    const out = next ? length(b, next) : 0;
    if (next && cut[k + 1] > 0 && out > 0) {
      const r = cut[k + 1];
      d += ` L ${at(end)} Q ${b.x} ${b.y} ${b.x + ((next.x - b.x) / out) * r} ${b.y + ((next.y - b.y) / out) * r}`;
    } else {
      d += ` L ${b.x} ${b.y}`;
    }
  });
  return d;
}

// A straight run from a to b, hopping at `crossings`.
export function hopPath(a: Point, b: Point, crossings: number[], radius = HOP_RADIUS): string {
  return routePath([a, b], [crossings], radius);
}
