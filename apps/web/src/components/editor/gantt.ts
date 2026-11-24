// The child page calendar's Gantt view (child-gantt.tsx): the days of a week,
// a month, three months, a year or three years, and a page's span of days on
// them. Dates are as the DATE column keeps them ("YYYY-MM-DD"). No dependencies
// (unit tests: test/gantt.test.ts).

export const GANTT_RANGES = ["week", "month", "quarter", "year", "threeYears"] as const;
export type GanttRange = (typeof GANTT_RANGES)[number];
export const isGanttRange = (v: unknown): v is GanttRange => (GANTT_RANGES as readonly unknown[]).includes(v);
// Too many days for a column each: these are drawn by month.
export const isLongGanttRange = (range: GanttRange) => range === "year" || range === "threeYears";

const RANGE_MONTHS: Record<Exclude<GanttRange, "week">, number> = { month: 1, quarter: 3, year: 12, threeYears: 36 };

export type Span = { start: string; end: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

// Noon UTC: no daylight-saving or time zone shifts.
const toTime = (date: string) => {
  const m = DATE.exec(date);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : NaN;
};
const fromTime = (time: number) => {
  const d = new Date(time);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const DAY = 86_400_000;

export const addDays = (date: string, n: number) => fromTime(toTime(date) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY);
export const weekdayOf = (date: string) => new Date(toTime(date)).getUTCDay();

const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
const addMonthsTo = (date: string, n: number) => {
  const d = new Date(toTime(firstOfMonth(date)));
  return fromTime(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
};

// The days shown around `anchor`: its week (from Sunday, as the calendar),
// its month, three months from its month, its calendar year, or three calendar
// years from its year.
export function ganttDays(anchor: string, range: GanttRange): string[] {
  let first: string;
  let count: number;
  if (range === "week") {
    first = addDays(anchor, -weekdayOf(anchor));
    count = 7;
  } else {
    first = isLongGanttRange(range) ? `${anchor.slice(0, 4)}-01-01` : firstOfMonth(anchor);
    count = daysBetween(first, addMonthsTo(first, RANGE_MONTHS[range]));
  }
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

// The anchor one period earlier (-1) or later (1).
export function shiftAnchor(anchor: string, range: GanttRange, direction: -1 | 1): string {
  if (range === "week") return addDays(anchor, 7 * direction);
  return addMonthsTo(anchor, RANGE_MONTHS[range] * direction);
}

// A page's span from its two dates: one alone is a single day, and an end
// before the start is ignored. Null without a usable date.
export function pageSpan(start: string, end: string): Span | null {
  const from = DATE.test(start) && !Number.isNaN(toTime(start)) ? start : "";
  const to = DATE.test(end) && !Number.isNaN(toTime(end)) ? end : "";
  if (!from && !to) return null;
  if (!from) return { start: to, end: to };
  return { start: from, end: to && to >= from ? to : from };
}

// Where a span falls on the days shown (indexes, inclusive), and whether it
// goes on past either side. Null if it's outside them.
export function placeSpan(span: Span, days: string[]): { from: number; to: number; before: boolean; after: boolean } | null {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || span.end < first || span.start > last) return null;
  return {
    from: Math.max(0, daysBetween(first, span.start)),
    to: Math.min(days.length - 1, daysBetween(first, span.end)),
    before: span.start < first,
    after: span.end > last,
  };
}

export const moveSpan = (span: Span, n: number): Span => ({ start: addDays(span.start, n), end: addDays(span.end, n) });

// One end moved by `n` days, stopping at the other end.
export function resizeSpan(span: Span, edge: "start" | "end", n: number): Span {
  if (edge === "start") {
    const start = addDays(span.start, n);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  const end = addDays(span.end, n);
  return { start: span.start, end: end < span.start ? span.start : end };
}
