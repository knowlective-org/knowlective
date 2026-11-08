import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { fetchVia } from "../src/lib/outbound-proxy";

// fetch() through the outbound proxy (lib/outbound-proxy.ts), as single
// sign-on uses it: against a proxy that answers itself.
//   pnpm --filter web test:unit

describe("fetch through the outbound proxy", () => {
  const seen: { url?: string; method?: string; type?: string; auth?: string; body: string }[] = [];
  const proxy = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ url: req.url, method: req.method, type: req.headers["content-type"], auth: req.headers["proxy-authorization"], body });
      res.writeHead(201, { "Content-Type": "application/json", "Set-Cookie": ["a=1", "b=2"] });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  let proxyUrl = "";
  before(async () => {
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    proxyUrl = `http://user:p%40ss@127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });
  after(() => new Promise((resolve) => proxy.close(resolve)));

  test("the request reaches the proxy whole, and the answer comes back as a Response", async () => {
    const response = await fetchVia(proxyUrl, new URL("http://idp.example.invalid/token"), {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "abc" }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get("content-type"), "application/json");
    const request = seen.at(-1)!;
    assert.equal(request.url, "http://idp.example.invalid/token");
    assert.equal(request.method, "POST");
    assert.equal(request.type, "application/x-www-form-urlencoded;charset=UTF-8");
    assert.equal(request.body, "grant_type=authorization_code&code=abc");
    // The proxy's credentials, decoded.
    assert.equal(request.auth, `Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  });

  test("a body given as bytes is sent as it is", async () => {
    await fetchVia(proxyUrl, new URL("http://idp.example.invalid/x"), { method: "POST", body: new TextEncoder().encode("bytes") });
    assert.equal(seen.at(-1)!.body, "bytes");
  });
});
