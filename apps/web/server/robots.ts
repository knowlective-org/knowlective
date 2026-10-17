import type { ServerResponse } from "node:http";
import { createPrismaClient } from "shared";
import { NOINDEX, registerSearchEngineSetting } from "../src/lib/search-engines";

// Keeps search engines out unless a site admin allows them
// (InstanceConfig.searchEnginesAllowed, default off): every response —
// pages, attachments, everything — carries X-Robots-Tag: noindex, nofollow.
// A header rather than robots.txt: a crawler kept out by robots.txt never
// sees the noindex, and may still list a URL it found linked elsewhere.
//
// The setting is cached; the admin action invalidates it on change, and it's
// re-read now and then anyway.

const MAX_AGE_MS = 60_000;

export function createRobots() {
  const prisma = createPrismaClient();
  let cached: { allowed: boolean; at: number } | null = null;
  let loading: Promise<boolean> | null = null;
  registerSearchEngineSetting({ invalidate: () => (cached = null) });

  const allowed = (): boolean | Promise<boolean> => {
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.allowed;
    loading ??= prisma.instanceConfig
      .findUnique({ where: { id: 1 }, select: { searchEnginesAllowed: true } })
      // Not set up yet, or unreadable: keep them out.
      .then((config) => config?.searchEnginesAllowed ?? false, () => false)
      .then((value) => {
        cached = { allowed: value, at: Date.now() };
        loading = null;
        return value;
      });
    return loading;
  };

  return {
    // Sets the header on `res` before it's handled.
    async apply(res: ServerResponse): Promise<void> {
      if (!(await allowed())) res.setHeader("X-Robots-Tag", NOINDEX);
    },
    stop: () => prisma.$disconnect(),
  };
}
