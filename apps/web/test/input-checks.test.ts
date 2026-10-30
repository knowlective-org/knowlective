import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { safeNextPath } from "../src/lib/auth/safe-next";
import { contentDisposition } from "../src/lib/content-disposition";
import { isAllowedAddress, parsePreviewUrl } from "../src/lib/link-preview";
import { checkLogoSvg } from "../src/lib/logo-svg";
import { safeHttpUrl } from "../src/lib/safe-url";
import { parseVideoUrl } from "../src/components/editor/video-url";

// The checks that stand between untrusted input and the server or the
// browser: addresses the server may fetch from (link previews), uploaded
// logos, URLs from the shared document, attachment names, and where to go
// after logging in.
//   pnpm --filter web test:unit

describe("link previews: addresses the server may fetch from", () => {
  const refused = [
    "http://127.0.0.1/",
    "http://localhost.localdomain.invalid/", // a name: only refused at connection (not here)
    "http://2130706433/", // 127.0.0.1 as one number
    "http://0177.0.0.1/", // octal
    "http://0x7f.0.0.1/", // hex
    "http://0/", // 0.0.0.0
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/", // IPv4-mapped, dotted
    "http://[::ffff:7f00:1]/", // IPv4-mapped, hex (what the URL parser writes)
    "http://[::ffff:a9fe:a9fe]/", // metadata, IPv4-mapped
    "http://[0:0:0:0:0:ffff:7f00:1]/",
    "http://[fe80::1]/", // link-local
    "http://10.0.0.1/", // private (allowed only for the intranet setting)
    "http://192.168.1.1/",
    "http://[fd00::1]/", // unique local
    "http://user:pass@example.com/", // credentials
    "ftp://example.com/",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ];
  for (const url of refused) {
    if (url.includes("localdomain.invalid")) continue;
    test(`refuses ${url}`, () => assert.equal(parsePreviewUrl(url), null));
  }
  test("accepts public addresses and names", () => {
    assert.ok(parsePreviewUrl("https://example.com/page"));
    assert.ok(parsePreviewUrl("http://93.184.215.14/"));
    assert.ok(parsePreviewUrl("http://[2606:2800:21f:cb07:6820:80da:af6b:8b2c]/"));
  });
  test("private addresses only with the intranet setting; loopback and link-local never", () => {
    assert.ok(parsePreviewUrl("http://10.0.0.1/", true));
    assert.ok(parsePreviewUrl("http://[fd00::1]/", true));
    assert.equal(parsePreviewUrl("http://127.0.0.1/", true), null);
    assert.equal(parsePreviewUrl("http://[::ffff:7f00:1]/", true), null);
    assert.equal(parsePreviewUrl("http://169.254.169.254/", true), null);
  });
  test("resolved addresses (checked at connection) follow the same rules", () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:7f00:1", "::ffff:127.0.0.1", "169.254.169.254", "::ffff:a9fe:a9fe", "0.0.0.0", "64:ff9b::7f00:1"]) {
      assert.equal(isAllowedAddress(a, true), false, a);
    }
    assert.equal(isAllowedAddress("::ffff:10.0.0.1", false), false);
    assert.equal(isAllowedAddress("93.184.215.14", false), true);
  });
});

describe("uploaded logos (SVG)", () => {
  const svg = (inner: string, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner}</svg>`;
  test("accepts drawing", () => {
    assert.ok("svg" in checkLogoSvg(svg('<rect width="10" height="10" fill="url(#g)"/><text x="0" y="9">K</text>')));
  });
  const unsafe: [string, string][] = [
    ["script", svg("<script>alert(1)</script>")],
    ["namespaced script", svg('<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>')],
    ["event attribute", svg('<rect onload="alert(1)"/>')],
    ["event attribute after a slash", '<svg/onload="alert(1)" xmlns="http://www.w3.org/2000/svg"></svg>'],
    ["event attribute after a quote", svg('<rect x="1"onclick="alert(1)"/>')],
    ["foreignObject", svg("<foreignObject><div>x</div></foreignObject>")],
    ["namespaced foreignObject", svg("<s:foreignObject><div>x</div></s:foreignObject>")],
    ["link", svg('<a href="https://evil.example"><text>x</text></a>')],
    ["xlink:href", svg('<use xlink:href="https://evil.example/x.svg#a"/>')],
    ["image", svg('<image href="https://evil.example/x.png"/>')],
    ["external style", svg("<style>@import url(https://evil.example/x.css);</style>")],
    ["external url()", svg('<rect style="fill:url(https://evil.example/x)"/>')],
    ["javascript: URL", svg('<rect style="background:javascript:alert(1)"/>')],
    ["entity", '<!DOCTYPE svg [<!ENTITY x "y">]>' + svg("<text>&x;</text>")],
    ["animation that can set href", svg('<set attributeName="href" to="javascript:alert(1)"/>')],
    ["handler element", svg('<handler type="application/ecmascript">alert(1)</handler>')],
  ];
  for (const [what, input] of unsafe) {
    // Refused either way ("unsafe", or "notSvg" when it can't even start as an SVG).
    test(`refuses ${what}`, () => assert.ok("error" in checkLogoSvg(input)));
  }
  test("refuses what isn't SVG", () => assert.deepEqual(checkLogoSvg("<html><body/></html>"), { error: "notSvg" }));
});

describe("URLs from the shared document", () => {
  test("links: http(s) only", () => {
    assert.equal(safeHttpUrl("https://example.com/"), "https://example.com/");
    for (const u of ["javascript:alert(1)", " javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "//evil.example"]) {
      assert.equal(safeHttpUrl(u), null, u);
    }
  });
  test("videos: only real video sites, and the player's address is built from the id", () => {
    const yt = parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.ok(yt && yt.kind === "embed" && yt.embedUrl.startsWith("https://www.youtube"));
    for (const u of [
      "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://evil.example/watch?v=dQw4w9WgXcQ&youtube.com",
      "https://www.youtube.com/watch?v=<script>",
      "javascript:alert('youtube.com/watch?v=dQw4w9WgXcQ')",
    ]) {
      const parsed = parseVideoUrl(u);
      assert.ok(!parsed || parsed.kind !== "embed", u);
    }
  });
});

describe("attachment names in Content-Disposition", () => {
  test("can't break out of the header or the quoted name", () => {
    const header = contentDisposition("attachment", 'a"; filename="evil.html\r\nSet-Cookie: x=1.txt');
    assert.doesNotMatch(header, /[\r\n]/);
    assert.match(header, /^attachment; filename="a_; filename=_evil\.html__Set-Cookie: x=1\.txt"; filename\*=UTF-8''/);
  });
  test("keeps the real name for browsers (RFC 5987)", () => {
    assert.match(contentDisposition("attachment", "資料.pdf"), /filename\*=UTF-8''%E8%B3%87%E6%96%99\.pdf$/);
  });
});

describe("where to go after logging in", () => {
  test("paths on this site", () => {
    assert.equal(safeNextPath("/pages/abc?x=1"), "/pages/abc?x=1");
  });
  for (const next of [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "\\/evil.example/",
    "/\t/evil.example/", // browsers drop tabs and newlines from URLs: //evil.example
    "/\n/evil.example/",
    "/\r/evil.example/",
    " //evil.example/",
    "javascript:alert(1)",
  ]) {
    test(`not ${JSON.stringify(next)}`, () => assert.equal(safeNextPath(next), "/"));
  }
});
