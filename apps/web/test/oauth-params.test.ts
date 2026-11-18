import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  isClientMetadataUrl,
  isValidCodeChallenge,
  isValidRedirectUri,
  parseClientMetadata,
  parseScope,
  pkceMatches,
  redirectTarget,
  redirectUriMatches,
  redirectWith,
  wellKnownUnderBasePath,
} from "../src/lib/oauth/params";

// What the OAuth authorization server accepts from apps (lib/oauth/params.ts).

test("redirect URIs: https, http only to this computer, or an app's own scheme", () => {
  for (const ok of [
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:6274/oauth/callback",
    "http://127.0.0.1/cb",
    "http://[::1]:8080/cb",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
    "com.example.app:/oauth",
  ]) {
    assert.equal(isValidRedirectUri(ok), true, ok);
  }
  for (const bad of [
    "http://example.com/cb",
    "http://localhost.evil.example/cb",
    "https://example.com/cb#frag",
    "https://user:pass@example.com/cb",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "vbscript:x",
    "https://example.com/c b",
    "https://example.com/\ncb",
    "",
    "/relative",
    42,
    null,
  ]) {
    assert.equal(isValidRedirectUri(bad), false, String(bad));
  }
});

test("a requested redirect URI must be registered; loopback may change its port", () => {
  const registered = ["https://app.example/cb", "http://127.0.0.1/cb"];
  assert.equal(redirectUriMatches("https://app.example/cb", registered), true);
  assert.equal(redirectUriMatches("http://127.0.0.1:53111/cb", registered), true);
  assert.equal(redirectUriMatches("https://app.example/cb/", registered), false);
  assert.equal(redirectUriMatches("https://app.example/cb?x=1", registered), false);
  assert.equal(redirectUriMatches("https://app.example:8443/cb", registered), false);
  assert.equal(redirectUriMatches("http://127.0.0.1:53111/other", registered), false);
  assert.equal(redirectUriMatches("http://localhost:53111/cb", registered), false);
  assert.equal(redirectUriMatches("not a url", registered), false);
});

test("scope: write includes read; nothing asked means both; unknown scopes are ignored", () => {
  assert.deepEqual(parseScope("read"), { write: false });
  assert.deepEqual(parseScope("read write"), { write: true });
  assert.deepEqual(parseScope("write"), { write: true });
  assert.deepEqual(parseScope("read offline_access"), { write: false });
  assert.deepEqual(parseScope(""), { write: true });
  assert.deepEqual(parseScope(undefined), { write: true });
  assert.deepEqual(parseScope("admin"), { write: true });
});

test("PKCE: S256 of the verifier, compared exactly", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(isValidCodeChallenge(challenge), true);
  assert.equal(pkceMatches(verifier, challenge), true);
  assert.equal(pkceMatches(verifier + "x", challenge), false);
  // The challenge itself as the verifier (the "plain" method) is refused.
  assert.equal(pkceMatches(challenge, challenge), false);
  assert.equal(pkceMatches("short", challenge), false);
  assert.equal(pkceMatches(undefined, challenge), false);
  assert.equal(isValidCodeChallenge("too-short"), false);
  assert.equal(isValidCodeChallenge(challenge + "="), false);
});

test("client metadata document URLs: https with a path, as written", () => {
  assert.equal(isClientMetadataUrl("https://app.example/oauth/client.json"), true);
  assert.equal(isClientMetadataUrl("https://app.example/"), false);
  assert.equal(isClientMetadataUrl("https://app.example"), false);
  assert.equal(isClientMetadataUrl("http://app.example/client.json"), false);
  assert.equal(isClientMetadataUrl("https://app.example/a/../client.json"), false);
  assert.equal(isClientMetadataUrl("https://APP.example/client.json"), false);
  assert.equal(isClientMetadataUrl("https://app.example/client.json#x"), false);
  assert.equal(isClientMetadataUrl("https://u:p@app.example/client.json"), false);
  assert.equal(isClientMetadataUrl("knc_abc"), false);
});

test("client metadata: redirect URIs required and checked, public clients only, the name cleaned", () => {
  const ok = parseClientMetadata({ client_name: " My‮ App\u0007 ", redirect_uris: ["https://a.example/cb", "https://a.example/cb"] });
  assert.deepEqual(ok, { name: "My App", redirectUris: ["https://a.example/cb"], clientUri: null });
  assert.equal(
    (parseClientMetadata({ redirect_uris: ["https://a.example/cb"], client_uri: "javascript:alert(1)" }) as { clientUri: unknown }).clientUri,
    null,
  );
  const refused = [
    {},
    { redirect_uris: [] },
    { redirect_uris: "https://a.example/cb" },
    { redirect_uris: ["http://a.example/cb"] },
    { redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" },
    { redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] },
    { redirect_uris: ["https://a.example/cb"], response_types: ["token"] },
    { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) },
  ];
  for (const meta of refused) assert.ok("error" in parseClientMetadata(meta), JSON.stringify(meta));
  assert.equal((parseClientMetadata({ redirect_uris: ["http://x.example/cb"] }) as { code: string }).code, "invalid_redirect_uri");
  // A document must name itself.
  const url = "https://app.example/client.json";
  assert.ok("error" in parseClientMetadata({ client_id: "https://other.example/client.json", redirect_uris: ["https://a.example/cb"] }, url));
  assert.ok(!("error" in parseClientMetadata({ client_id: url, redirect_uris: ["https://a.example/cb"] }, url)));
});

test("back to the app: parameters added to its own query; the target shown", () => {
  assert.equal(
    redirectWith("https://a.example/cb?x=1", { code: "c&d", state: "s", iss: undefined }),
    "https://a.example/cb?x=1&code=c%26d&state=s",
  );
  assert.equal(redirectTarget("https://a.example:8443/cb"), "a.example:8443");
  assert.equal(redirectTarget("cursor://anysphere/cb"), "cursor");
});

test("OAuth metadata at the root is served under the base path", () => {
  assert.equal(wellKnownUnderBasePath("/.well-known/oauth-authorization-server/kn", "/kn"), "/kn/.well-known/oauth-authorization-server");
  assert.equal(
    wellKnownUnderBasePath("/.well-known/oauth-protected-resource/kn/api/mcp", "/kn"),
    "/kn/.well-known/oauth-protected-resource/api/mcp",
  );
  assert.equal(wellKnownUnderBasePath("/.well-known/oauth-authorization-server/knx", "/kn"), null);
  assert.equal(wellKnownUnderBasePath("/.well-known/oauth-authorization-server", "/kn"), null);
  assert.equal(wellKnownUnderBasePath("/.well-known/oauth-authorization-server/kn", ""), null);
  assert.equal(wellKnownUnderBasePath("/kn/admin", "/kn"), null);
});
