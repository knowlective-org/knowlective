import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accessLogLine, logForwardedFor, logPath } from "../src/lib/access-log";

// The access log's line (lib/access-log.ts): what's logged comes from the
// request, so nothing in it may start a new line or field, or leak a token.
//   pnpm --filter web test:unit

describe("access log", () => {
  test("tokens in paths aren't logged, with or without a base path", () => {
    assert.equal(logPath("/invite/abc123", ""), "/invite/*");
    assert.equal(logPath("/reset-password/abc/x", ""), "/reset-password/*/x");
    assert.equal(logPath("/kn/email-change/abc", "/kn"), "/kn/email-change/*");
    assert.equal(logPath("/admin/oidc-test/abc", ""), "/admin/oidc-test/*");
    assert.equal(logPath("/pages/abc", ""), "/pages/abc");
  });

  test("X-Forwarded-For is kept as it came, without what could break the line", () => {
    assert.equal(logForwardedFor("198.51.100.7, 10.0.0.1"), "198.51.100.7,10.0.0.1");
    assert.equal(logForwardedFor(["2001:db8::1", "10.0.0.1"]), "2001:db8::1,10.0.0.1");
    assert.equal(logForwardedFor(undefined), "-");
    assert.ok(!/[\s"]/.test(logForwardedFor('1.2.3.4\n2026-01-01 "x" GET /')));
    assert.ok(logForwardedFor("1".repeat(1000)).length <= 200);
  });

  test("one line", () => {
    const line = accessLogLine({
      at: new Date("2026-11-13T01:02:03.456Z"),
      ip: "203.0.113.5",
      method: "GET",
      path: "/pages/abc",
      status: 200,
      ms: 12.4,
      forwardedFor: "203.0.113.5",
    });
    assert.equal(line, "2026-11-13T01:02:03.456Z 203.0.113.5 GET /pages/abc 200 12 xff=203.0.113.5\n");
    assert.equal(accessLogLine({ at: new Date(0), ip: "a b\nc", method: "G\nET", path: "/", status: null, ms: 0, forwardedFor: "-" }).split("\n").length, 2);
  });
});
