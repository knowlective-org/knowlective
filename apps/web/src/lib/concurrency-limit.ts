// At most `max` runs of a slow task at once, in this process; beyond that a
// run is refused at once (not queued), so a burst of requests can't pile up
// work. No dependencies, so it can be tested in Node.

export type Limited<T> = { ok: true; value: T } | { ok: false };

export function createConcurrencyLimit(max: number) {
  let running = 0;
  return async function run<T>(task: () => Promise<T>): Promise<Limited<T>> {
    if (running >= max) return { ok: false };
    running++;
    try {
      return { ok: true, value: await task() };
    } finally {
      running--;
    }
  };
}

// Checking a password is deliberately slow (scrypt: a few hundred ms and
// about 128 MB each, on Node's small thread pool shared with file and
// network work), and logging in needs no account: this many at once, for
// every login form together.
export const passwordCheckLimit = createConcurrencyLimit(2);
