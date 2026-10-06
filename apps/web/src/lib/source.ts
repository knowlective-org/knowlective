// Where the running code's source can be obtained (AGPL-3.0 section 13:
// users interacting with a modified version over a network must be offered
// its source). Shown in the admin console. Anyone running a modified yosuga
// should point YOSUGA_SOURCE_URL at their own published source.

export const UPSTREAM_SOURCE_URL = "https://github.com/hachibay/yosuga";

export function getSourceUrl(): string {
  const configured = process.env.YOSUGA_SOURCE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      // Fall through to the upstream repository.
    }
  }
  return UPSTREAM_SOURCE_URL;
}
