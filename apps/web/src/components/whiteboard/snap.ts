import type { Rect } from "./geometry";

// Snapping while items are dragged or resized, and lining up the selection.
// No dependencies (unit tests: test/whiteboard-snap.test.ts).

// The board's dots (whiteboard.module.css) are this far apart.
export const GRID = 24;

// Lines shown where an edge or a center was snapped to another item's:
// vertical ones at `x`, horizontal ones at `y`, across the items they line up.
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

const edgesX = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const edgesY = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

// The smallest shift (within `threshold`) that lines one of `ours` up with
// one of `theirs`, and the lines it lines up on.
function nearest(ours: number[], theirs: number[], threshold: number): { shift: number; at: number[] } | null {
  let best: { shift: number; at: number[] } | null = null;
  for (const a of ours) {
    for (const b of theirs) {
      const shift = b - a;
      if (Math.abs(shift) > threshold) continue;
      if (!best || Math.abs(shift) < Math.abs(best.shift) - 0.001) best = { shift, at: [b] };
      else if (Math.abs(shift - best.shift) < 0.001 && !best.at.includes(b)) best.at.push(b);
    }
  }
  return best;
}

const snapToGrid = (n: number) => Math.round(n / GRID) * GRID;

// Where the dragged items (`moving`: the rectangle around them, already
// moved by the pointer) settle: their left, center or right on another
// item's left, center or right when one is within `threshold` (likewise
// top to bottom), or else (with `grid`) their top left corner on a dot.
// Returns the extra shift and the guides to show.
export function snapMove(moving: Rect, others: Rect[], threshold: number, grid: boolean): { dx: number; dy: number; guides: Guide[] } {
  const x = nearest(edgesX(moving), others.flatMap(edgesX), threshold);
  const y = nearest(edgesY(moving), others.flatMap(edgesY), threshold);
  const dx = x ? x.shift : grid ? snapToGrid(moving.x) - moving.x : 0;
  const dy = y ? y.shift : grid ? snapToGrid(moving.y) - moving.y : 0;
  const placed = { ...moving, x: moving.x + dx, y: moving.y + dy };
  return { dx, dy, guides: guidesFor(placed, others, x?.at ?? [], y?.at ?? []) };
}

// A box being resized from its bottom right corner (`box` at its new size):
// its right edge and bottom snap like a move, its top left stays.
export function snapResize(box: Rect, others: Rect[], threshold: number, grid: boolean): { w: number; h: number; guides: Guide[] } {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const x = nearest([right], others.flatMap(edgesX), threshold);
  const y = nearest([bottom], others.flatMap(edgesY), threshold);
  const w = box.w + (x ? x.shift : grid ? snapToGrid(right) - right : 0);
  const h = box.h + (y ? y.shift : grid ? snapToGrid(bottom) - bottom : 0);
  return { w, h, guides: guidesFor({ ...box, w, h }, others, x?.at ?? [], y?.at ?? []) };
}

// A guide along each snapped line, spanning the items on it.
function guidesFor(placed: Rect, others: Rect[], xs: number[], ys: number[]): Guide[] {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const guides: Guide[] = [];
  for (const at of xs) {
    const on = [placed, ...others.filter((r) => edgesX(r).some((e) => near(e, at)))];
    guides.push({ axis: "x", at, from: Math.min(...on.map((r) => r.y)), to: Math.max(...on.map((r) => r.y + r.h)) });
  }
  for (const at of ys) {
    const on = [placed, ...others.filter((r) => edgesY(r).some((e) => near(e, at)))];
    guides.push({ axis: "y", at, from: Math.min(...on.map((r) => r.x)), to: Math.max(...on.map((r) => r.x + r.w)) });
  }
  return guides;
}

export const ALIGNMENTS = ["left", "centerX", "right", "top", "centerY", "bottom"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

// The boxes lined up on the edge (or center) of the key box (`key`, which
// stays where it is), or without one, of the rectangle around them: each
// one's new top left, by id.
export function align<T extends Rect & { id: string }>(boxes: T[], how: Alignment, key?: string): Map<string, { x: number; y: number }> {
  const keyBox = boxes.find((b) => b.id === key);
  const around = keyBox ? [keyBox] : boxes;
  const left = Math.min(...around.map((b) => b.x));
  const right = Math.max(...around.map((b) => b.x + b.w));
  const top = Math.min(...around.map((b) => b.y));
  const bottom = Math.max(...around.map((b) => b.y + b.h));
  const at = new Map<string, { x: number; y: number }>();
  for (const b of boxes) {
    const x =
      how === "left" ? left : how === "right" ? right - b.w : how === "centerX" ? Math.round((left + right) / 2 - b.w / 2) : b.x;
    const y =
      how === "top" ? top : how === "bottom" ? bottom - b.h : how === "centerY" ? Math.round((top + bottom) / 2 - b.h / 2) : b.y;
    at.set(b.id, { x, y });
  }
  return at;
}

// The boxes spread out evenly across (or down), the first and last staying
// where they are: the same gap between each and the next. Three or more.
export function distribute<T extends Rect & { id: string }>(boxes: T[], axis: "x" | "y"): Map<string, { x: number; y: number }> {
  const at = new Map<string, { x: number; y: number }>();
  if (boxes.length < 3) return at;
  const pos = (b: T) => (axis === "x" ? b.x : b.y);
  const size = (b: T) => (axis === "x" ? b.w : b.h);
  const sorted = [...boxes].sort((a, b) => pos(a) - pos(b) || (a.id < b.id ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - sorted.reduce((sum, b) => sum + size(b), 0)) / (sorted.length - 1);
  let next = pos(first);
  for (const b of sorted) {
    const p = b === last ? pos(last) : Math.round(next);
    at.set(b.id, axis === "x" ? { x: p, y: b.y } : { x: b.x, y: p });
    next += size(b) + gap;
  }
  return at;
}
