// Whether search engines may index the site (InstanceConfig.
// searchEnginesAllowed, set in /admin). The custom server
// (server/robots.ts) adds X-Robots-Tag to every response and keeps the
// setting cached; the admin action tells it when the setting changes. The
// Next.js bundle is a separate module graph in the same process, hence
// globalThis (like lib/collab-events.ts). Keep dependency-free.

export const NOINDEX = "noindex, nofollow";

type SearchEngineBridge = { invalidate(): void };

const BRIDGE_KEY = Symbol.for("knowlective.search-engines");

export function registerSearchEngineSetting(bridge: SearchEngineBridge) {
  (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = bridge;
}

// The setting was changed: applies from the next request.
export function searchEngineSettingChanged() {
  ((globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as SearchEngineBridge | undefined)?.invalidate();
}
