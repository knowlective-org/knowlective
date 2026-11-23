// Presentation pages (Page.kind = PRESENTATION): each slide is a child page
// (kind SLIDE) holding a whiteboard canvas of a fixed size. Rules shared by
// the browser and the server: no dependencies.

export const MAX_SLIDES = 200;
// Slides are 16:9, in the board's coordinates.
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
export const SLIDE_FRAME = { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT } as const;

export const NUMBER_POSITIONS = ["left", "center", "right"] as const;
export type NumberPosition = (typeof NUMBER_POSITIONS)[number];
export const MIN_NUMBER_START = 0;
export const MAX_NUMBER_START = 9999;

export type PresentationSettingsView = {
  numberingEnabled: boolean;
  numberStart: number;
  numberPosition: NumberPosition;
  hiddenSlideIds: string[];
  numberHiddenSlideIds: string[];
};

export const DEFAULT_SETTINGS: PresentationSettingsView = {
  numberingEnabled: false,
  numberStart: 1,
  numberPosition: "right",
  hiddenSlideIds: [],
  numberHiddenSlideIds: [],
};

export const isNumberPosition = (value: unknown): value is NumberPosition =>
  typeof value === "string" && (NUMBER_POSITIONS as readonly string[]).includes(value);

export const isNumberStart = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_NUMBER_START && value <= MAX_NUMBER_START;

// Settings as stored, with anything out of range back to its default.
export function readSettings(
  row:
    | {
        numberingEnabled: boolean;
        numberStart: number;
        numberPosition: string;
        hiddenSlideIds: string[];
        numberHiddenSlideIds: string[];
      }
    | null
    | undefined,
): PresentationSettingsView {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    numberingEnabled: row.numberingEnabled,
    numberStart: isNumberStart(row.numberStart) ? row.numberStart : DEFAULT_SETTINGS.numberStart,
    numberPosition: isNumberPosition(row.numberPosition) ? row.numberPosition : DEFAULT_SETTINGS.numberPosition,
    hiddenSlideIds: row.hiddenSlideIds,
    numberHiddenSlideIds: row.numberHiddenSlideIds,
  };
}

// The slides presenting and the PDF go through, in order.
export function shownSlides(order: readonly string[], settings: Pick<PresentationSettingsView, "hiddenSlideIds">): string[] {
  const hidden = new Set(settings.hiddenSlideIds);
  return order.filter((id) => !hidden.has(id));
}

// The number shown on each slide (null: none). A hidden slide isn't counted;
// a slide with only its number hidden is counted, so with a cover the next
// slide is 2 (or 1, starting from 0).
export function slideNumbers(
  order: readonly string[],
  settings: Pick<PresentationSettingsView, "numberingEnabled" | "numberStart" | "hiddenSlideIds" | "numberHiddenSlideIds">,
): Map<string, number | null> {
  const hidden = new Set(settings.hiddenSlideIds);
  const noNumber = new Set(settings.numberHiddenSlideIds);
  const out = new Map<string, number | null>();
  let next = settings.numberStart;
  for (const id of order) {
    if (hidden.has(id)) {
      out.set(id, null);
      continue;
    }
    out.set(id, settings.numberingEnabled && !noNumber.has(id) ? next : null);
    next++;
  }
  return out;
}

// The slide to stay on when `current` can't be shown (hidden or gone): the
// next shown one, else the last shown before it, else none.
export function nearestShownSlide(
  order: readonly string[],
  settings: Pick<PresentationSettingsView, "hiddenSlideIds">,
  current: string,
): string | null {
  const hidden = new Set(settings.hiddenSlideIds);
  const at = order.indexOf(current);
  if (at >= 0 && !hidden.has(current)) return current;
  const from = at < 0 ? 0 : at;
  for (let i = from; i < order.length; i++) if (!hidden.has(order[i])) return order[i];
  for (let i = from - 1; i >= 0; i--) if (!hidden.has(order[i])) return order[i];
  return null;
}
