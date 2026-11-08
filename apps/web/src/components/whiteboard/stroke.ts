import type { Stroke } from "@/lib/whiteboard";

// How each stroke of a connector or line is drawn, on screen and in the
// export: the line's width and dashes; for "double", a thinner line in the
// board's color down its middle (`gap`), leaving two lines. Thick lines'
// arrowheads (`large`) sit further over their end, so it stays under them.
export const STROKE_DRAW: Record<Stroke, { width: number; dash?: string; gap?: number; large: boolean }> = {
  solid: { width: 2, large: false },
  bold: { width: 4, large: true },
  dashed: { width: 2, dash: "8 6", large: false },
  double: { width: 6, gap: 2, large: true },
};

// Arrowheads (on the board's units, whatever the line's width): one size for
// every stroke, and how far back from the tip the line ends.
export const ARROW_HEADS = {
  normal: { size: 19, refX: 9 },
  large: { size: 19, refX: 7 },
} as const;
