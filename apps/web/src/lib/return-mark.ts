// The link last followed from a screen, so that coming back to that screen
// can point at it again (components/return-highlight.tsx). No dependencies
// (unit tests: test/return-mark.test.ts).

export type ReturnMark = {
  // The screen the link was on (path and query, without the base path).
  from: string;
  // Where it led (as sameSitePath() gives it).
  to: string;
  // Among the links on that screen leading to the same place, which one
  // (0: the first), for a page linked twice.
  n: number;
  // When it was followed (ms).
  at: number;
};

export const RETURN_MARK_KEY = "knowlective-return-mark";

// Older than this, a mark is forgotten: it's for going back, not for a later
// visit.
export const RETURN_MARK_MAX_AGE_MS = 30 * 60 * 1000;

// The part of a path that tells screens apart: path and query, not the hash
// (a jump within the page isn't leaving it).
export function screenOf(path: string): string {
  const hash = path.indexOf("#");
  return hash === -1 ? path : path.slice(0, hash);
}

// The mark to show on `current` (a screen, as screenOf() gives it), or null:
// one left from this very screen, recently, by a link to another screen.
export function markFor(saved: unknown, current: string, now: number): ReturnMark | null {
  const mark = readMark(saved);
  if (!mark) return null;
  if (mark.from !== current || screenOf(mark.to) === current) return null;
  if (now - mark.at > RETURN_MARK_MAX_AGE_MS || mark.at > now + 60_000) return null;
  return mark;
}

// A mark read back from storage (anything may be there).
export function readMark(value: unknown): ReturnMark | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { from, to, n, at } = parsed as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string" || !from.startsWith("/") || !to.startsWith("/")) return null;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10_000) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { from, to, n, at };
}
