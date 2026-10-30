import { expect, test } from "@playwright/test";

// The baseline security headers on every response (server/security-headers.ts),
// and the admin console's stricter ones (next.config.ts), which replace them.

test("pages and files carry the security headers; the admin console stricter ones", async ({ request }) => {
  for (const path of ["login", "api/health"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["x-frame-options"], path).toBe("SAMEORIGIN");
    expect(headers["content-security-policy"], path).toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"], path).toContain("camera=()");
  }
  const admin = (await request.get("admin/login")).headers();
  expect(admin["x-frame-options"]).toBe("DENY");
  expect(admin["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(admin["referrer-policy"]).toBe("no-referrer");
  expect(admin["x-content-type-options"]).toBe("nosniff");
});
