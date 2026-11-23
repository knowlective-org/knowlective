// Presenting to everyone viewing a presentation. The presenter's position is
// a field of their awareness state in the presentation's document, so it
// reaches everyone connected, late joiners too, and goes away with their
// connection. The collab server (beforeHandleAwareness) decides what's in the
// field: admitPresenting(). No dependencies: browser, server and unit tests.

export type Presenting = { slideId: string; since: number };

const SLIDE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const MAX_STARTS = 5;
export const START_WINDOW_MS = 60_000;
export const MAX_MOVES = 40;
export const MOVE_WINDOW_MS = 10_000;

export const isSlideId = (value: unknown): value is string => typeof value === "string" && SLIDE_ID.test(value);

// As kept in awareness, read back checked.
export function readPresenting(raw: unknown): Presenting | null {
  if (!raw || typeof raw !== "object") return null;
  const { slideId, since } = raw as Record<string, unknown>;
  if (!isSlideId(slideId) || typeof since !== "number" || !Number.isSafeInteger(since) || since <= 0) return null;
  return { slideId, since };
}

// Whoever started first is presenting (should two start at the same moment).
export function currentStage<S extends { presenting?: unknown }>(
  states: Iterable<[number, S]>,
): { clientId: number; presenting: Presenting; state: S } | null {
  let best: { clientId: number; presenting: Presenting; state: S } | null = null;
  for (const [clientId, state] of states) {
    const presenting = readPresenting(state?.presenting);
    if (!presenting) continue;
    if (
      !best ||
      presenting.since < best.presenting.since ||
      (presenting.since === best.presenting.since && clientId < best.clientId)
    ) {
      best = { clientId, presenting, state };
    }
  }
  return best;
}

// How often one person may start presenting (each start asks everyone
// viewing to switch) and change slides, per presentation.
export class PresentingLimiter {
  private readonly starts = new Map<string, number[]>();
  private readonly moves = new Map<string, number[]>();

  private take(log: Map<string, number[]>, key: string, now: number, windowMs: number, max: number): boolean {
    // Forgets what's out of the window, so the map doesn't grow.
    if (log.size > 1000) {
      for (const [k, times] of log) if (!times.some((t) => now - t < windowMs)) log.delete(k);
    }
    const recent = (log.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      log.set(key, recent);
      return false;
    }
    recent.push(now);
    log.set(key, recent);
    return true;
  }

  allowStart(key: string, now: number) {
    return this.take(this.starts, key, now, START_WINDOW_MS, MAX_STARTS);
  }

  allowMove(key: string, now: number) {
    return this.take(this.moves, key, now, MOVE_WINDOW_MS, MAX_MOVES);
  }
}

// What goes in the field for an update from a connection: the slide asked
// for if it's allowed, else what was there (null: not presenting). The time
// it started is the server's.
export async function admitPresenting(input: {
  wanted: unknown;
  current: Presenting | null;
  someoneElsePresenting: boolean;
  key: string;
  now: number;
  limiter: PresentingLimiter;
  // The slide is in this presentation, and not hidden.
  isShown: (slideId: string) => Promise<boolean>;
}): Promise<Presenting | null> {
  const { wanted, current, someoneElsePresenting, key, now, limiter, isShown } = input;
  const slideId = wanted && typeof wanted === "object" ? (wanted as { slideId?: unknown }).slideId : null;
  if (!isSlideId(slideId)) return null;
  if (current?.slideId === slideId) return current;
  if (!current) {
    if (someoneElsePresenting || !limiter.allowStart(key, now)) return null;
  } else if (!limiter.allowMove(key, now)) {
    return current;
  }
  if (!(await isShown(slideId))) return current;
  return { slideId, since: current?.since ?? now };
}
