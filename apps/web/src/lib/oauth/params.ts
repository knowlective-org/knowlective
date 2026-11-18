import { createHash, timingSafeEqual } from "node:crypto";

// The checks of the OAuth authorization server (lib/oauth/) on what apps send:
// redirect URIs, scopes, PKCE, client metadata documents. No dependencies
// beyond node:crypto (unit-tested, test/oauth-params.test.ts): change one,
// add the way around it to the tests.

// What a token may do: the same as an API key's scope (READ, WRITE).
export const OAUTH_SCOPES = ["read", "write"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const MAX_CLIENT_NAME_LENGTH = 100;
export const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;

// Schemes that never take an authorization code: they'd run or show it.
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "ftp:", "ws:", "wss:"]);

const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

// A redirect URI an app may register: https; http only to this computer
// (loopback, RFC 8252 for desktop apps); or an app's own scheme
// ("cursor://…", RFC 8252 7.1). No fragment, no user info.
export function isValidRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URI_LENGTH) return false;
  if (/[\u0000- \u007f]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || raw.includes("#") || url.username || url.password) return false;
  if (url.protocol === "https:") return url.hostname.length > 0;
  if (url.protocol === "http:") return isLoopback(url.hostname);
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  // An app's own scheme: letters, digits, "+", "-", "." (RFC 3986).
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

// Whether the URI in a request is one the app registered. Exact, except that
// a loopback URI may use any port (RFC 8252 7.3: desktop apps take a free
// port when they start).
export function redirectUriMatches(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  let asked: URL;
  try {
    asked = new URL(requested);
  } catch {
    return false;
  }
  if (asked.protocol !== "http:" || !isLoopback(asked.hostname)) return false;
  return registered.some((r) => {
    try {
      const known = new URL(r);
      return (
        known.protocol === "http:" &&
        known.hostname === asked.hostname &&
        known.pathname === asked.pathname &&
        known.search === asked.search
      );
    } catch {
      return false;
    }
  });
}

// The scopes asked for: read and/or write. Write includes read (a token that
// writes must find what to write). Unknown scopes (offline_access, which
// some apps add) are ignored; none asked for means read and write.
export function parseScope(raw: unknown): { write: boolean } {
  if (typeof raw !== "string" || raw.trim() === "") return { write: true };
  const asked = raw.split(/\s+/).filter(Boolean);
  if (asked.includes("write")) return { write: true };
  if (asked.includes("read")) return { write: false };
  return { write: true };
}

export const scopeString = (write: boolean) => (write ? "read write" : "read");

// PKCE (RFC 7636), S256 only: the verifier's SHA-256, base64url, is the
// challenge. The verifier: 43 to 128 unreserved characters.
export function isValidCodeChallenge(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

// A Client ID Metadata Document's URL: https, with a path, nothing that would
// make two URLs name one app (draft-ietf-oauth-client-id-metadata-document).
export function isClientMetadataUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.href === raw &&
    url.pathname !== "/" &&
    !url.hash &&
    !url.username &&
    !url.password &&
    !/(^|\/)\.\.?(\/|$)/.test(url.pathname)
  );
}

export type ClientInfo = { name: string; redirectUris: string[]; clientUri: string | null };

// The parts of a client's metadata (a registration request, RFC 7591, or a
// fetched metadata document) that are used, or why it's refused. Public
// clients only: no secret is issued or accepted.
export type ClientMetadataError = { error: string; code: "invalid_redirect_uri" | "invalid_client_metadata" };

const bad = (error: string): ClientMetadataError => ({ error, code: "invalid_client_metadata" });

export function parseClientMetadata(input: unknown, expectedClientId?: string): ClientInfo | ClientMetadataError {
  if (!input || typeof input !== "object" || Array.isArray(input)) return bad("The client metadata must be a JSON object.");
  const meta = input as Record<string, unknown>;
  if (expectedClientId !== undefined && meta.client_id !== expectedClientId) {
    return bad("The document's client_id must be its own URL.");
  }
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { error: `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs.`, code: "invalid_redirect_uri" };
  }
  if (!uris.every(isValidRedirectUri)) {
    return {
      error: "Each redirect URI must be https, http to localhost, or an app's own scheme, without a fragment.",
      code: "invalid_redirect_uri",
    };
  }
  const method = meta.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return bad("Only public clients (token_endpoint_auth_method \"none\") are supported.");
  const grants = meta.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || !grants.includes("authorization_code"))) {
    return bad("grant_types must include authorization_code.");
  }
  const types = meta.response_types;
  if (types !== undefined && (!Array.isArray(types) || !types.includes("code"))) return bad("response_types must include code.");
  const rawName = typeof meta.client_name === "string" ? meta.client_name : "";
  // Shown on the consent screen: one line of plain text.
  const name = rawName.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, MAX_CLIENT_NAME_LENGTH);
  const clientUri =
    typeof meta.client_uri === "string" && /^https:\/\/[^\s]+$/.test(meta.client_uri) && meta.client_uri.length <= MAX_URI_LENGTH
      ? meta.client_uri
      : null;
  return { name, redirectUris: [...new Set(uris as string[])], clientUri };
}

// Where to send the person back with the code (or the error): the redirect
// URI with the parameters added, keeping its own query (RFC 6749 3.1.2).
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.href;
}

// The host to show on the consent screen for a redirect URI: where the code
// goes. An app's own scheme shows as itself.
export function redirectTarget(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "https:" || url.protocol === "http:" ? url.host : url.protocol.replace(/:$/, "");
}

// With a base path ("/kn"), the standard places of the OAuth metadata are at
// the root, the base path after the well-known name (RFC 8414 3.1, RFC 9728
// 3.1): "/.well-known/oauth-authorization-server/kn". The app's routes are
// all under the base path, so the custom server (server/index.ts) serves
// those at "/kn/.well-known/…". Returns that path, or null for any other.
export function wellKnownUnderBasePath(pathname: string, basePath: string): string | null {
  if (!basePath) return null;
  for (const name of ["oauth-authorization-server", "oauth-protected-resource"]) {
    const prefix = `/.well-known/${name}${basePath}`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return `${basePath}/.well-known/${name}${pathname.slice(prefix.length)}`;
    }
  }
  return null;
}
