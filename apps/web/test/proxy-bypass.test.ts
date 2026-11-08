import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bypassesProxy, parseBypassEntry, parseBypassList } from "../src/lib/proxy-bypass";

// The hosts reached without the outbound proxy (lib/proxy-bypass.ts).
//   pnpm --filter web test:unit

describe("proxy bypass list", () => {
  test("entries: host names, domains, addresses and ranges", () => {
    assert.equal(parseBypassEntry(" Mail.Example.co.jp "), "mail.example.co.jp");
    assert.equal(parseBypassEntry("*.example.co.jp"), ".example.co.jp");
    assert.equal(parseBypassEntry(".example.co.jp"), ".example.co.jp");
    assert.equal(parseBypassEntry("10.0.0.0/8"), "10.0.0.0/8");
    assert.equal(parseBypassEntry("192.0.2.10"), "192.0.2.10/32");
    assert.equal(parseBypassEntry("[2001:db8::1]"), "2001:db8::1/128");
    for (const bad of ["http://example.com", "exa mple", "*.", "10.0.0.0/33", "example.com:8080", "*.*.example.com", "-bad.example"]) {
      assert.equal(parseBypassEntry(bad), null, bad);
    }
    assert.deepEqual(parseBypassList("a.example\n*.b.example, 10.0.0.0/8  a.example\nhttp://x"), {
      entries: ["a.example", ".b.example", "10.0.0.0/8"],
      invalid: ["http://x"],
    });
  });

  test("a host is reached directly when an entry covers it", () => {
    const entries = ["mail.example.co.jp", ".intra.example", "10.0.0.0/8", "2001:db8::/32"];
    assert.equal(bypassesProxy("mail.example.co.jp", entries), true);
    assert.equal(bypassesProxy("MAIL.example.co.jp.", entries), true);
    assert.equal(bypassesProxy("other.example.co.jp", entries), false);
    // A domain covers itself and the hosts under it, not names that merely end the same.
    assert.equal(bypassesProxy("intra.example", entries), true);
    assert.equal(bypassesProxy("s3.intra.example", entries), true);
    assert.equal(bypassesProxy("notintra.example", entries), false);
    assert.equal(bypassesProxy("10.1.2.3", entries), true);
    assert.equal(bypassesProxy("11.1.2.3", entries), false);
    assert.equal(bypassesProxy("[2001:db8::5]", entries), true);
    // A name isn't matched against address ranges (it isn't looked up).
    assert.equal(bypassesProxy("ten.example", ["10.0.0.0/8"]), false);
  });

  test("this machine is always reached directly", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "::ffff:127.0.0.1"]) {
      assert.equal(bypassesProxy(host, []), true, host);
    }
    assert.equal(bypassesProxy("example.com", []), false);
  });
});
