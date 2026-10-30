// A fixed-window rate limit kept in this process (one per instance): at most
// `max` calls per `windowMs` for each key. Returns a function that counts a
// call and answers null (allowed) or the seconds until the window resets.
export function createRateLimiter(windowMs: number, max: number): (key: string) => number | null {
  const windows = new Map<string, { start: number; count: number }>();
  return (key) => {
    const now = Date.now();
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      if (windows.size > 10_000) {
        for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
      }
      return null;
    }
    w.count += 1;
    return w.count > max ? Math.ceil((w.start + windowMs - now) / 1000) : null;
  };
}
