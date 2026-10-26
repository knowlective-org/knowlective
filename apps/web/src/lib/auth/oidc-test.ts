import { randomBytes } from "node:crypto";
import * as client from "openid-client";
import {
  type LoginState,
  OIDC_STATE_MAX_AGE,
  type OidcTestTarget,
  discoverWith,
  oidcCallbackUrl,
  profileClaims,
  sealState,
} from "./oidc";
import { type Claims, groupNames, hasClaimText, nameTemplateClaims, renderDisplayName } from "./oidc-profile";

// The admin console's test login for single sign-on: a real sign-in at the
// IdP (as the user being tested, the user name filled in with login_hint),
// with the settings being edited. Nothing is made or changed here — no
// account, session or group — and the result page shows what a sign-in as
// that user would get: the display name, the groups and the claims, or why
// they couldn't be had. OpenID Connect has no way to read someone's claims
// without their sign-in, so this is the only test that matches a real login.
//
// Results are kept in this process for a while (one process serves the app),
// under a random id, for the admin who started the test only.

const RESULT_TTL_MS = 10 * 60 * 1000;
// Claims that only serve the protocol.
const PROTOCOL_CLAIMS = new Set(["nonce", "at_hash", "c_hash", "s_hash"]);
const MAX_CLAIMS = 100;
const MAX_VALUE_LENGTH = 300;

export type OidcTestFailure = "expired" | "cancelled" | "failed" | "unavailable";

export type OidcTestResult =
  | {
      ok: false;
      reason: OidcTestFailure;
      // The IdP's error code (e.g. invalid_client), when it gave one.
      idpError: string | null;
    }
  | {
      ok: true;
      loginHint: string;
      subject: string;
      email: string | null;
      emailVerified: boolean;
      // As in profileClaims(): read, failed, or no UserInfo endpoint.
      userInfo: boolean | null;
      nameSetting: string;
      displayName: string | null;
      // The claims the display name reads that didn't come.
      missingNameClaims: string[];
      groupsClaim: string;
      // Null: the claim didn't come.
      groups: string[] | null;
      claims: { name: string; value: string; source: "idToken" | "userInfo" | "both" }[];
    };

type Entry = { adminUserId: string | null; result: OidcTestResult; expires: number };

// On globalThis: the callback (a Route Handler) and the result page are
// separate bundles.
const store = ((globalThis as { __knowlectiveOidcTests?: Map<string, Entry> }).__knowlectiveOidcTests ??= new Map());

function keep(adminUserId: string | null, result: OidcTestResult): string {
  const now = Date.now();
  for (const [id, entry] of store) if (entry.expires <= now) store.delete(id);
  const id = randomBytes(16).toString("base64url");
  store.set(id, { adminUserId, result, expires: now + RESULT_TTL_MS });
  return id;
}

// The result for the admin who started the test (null for the master
// password login), or null when it's gone or someone else's.
export function testResult(id: string, adminUserId: string | null): OidcTestResult | null {
  const entry = store.get(id);
  if (!entry || entry.expires <= Date.now() || entry.adminUserId !== adminUserId) return null;
  return entry.result;
}

// The IdP URL to open, and the state cookie (the same one a sign-in uses).
export async function beginTestLogin(target: OidcTestTarget): Promise<{ url: URL; cookie: string }> {
  const config = await discoverWith({ issuer: target.issuer, clientId: target.clientId, clientSecret: target.clientSecret });
  const verifier = client.randomPKCECodeVerifier();
  const state: LoginState = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier,
    next: "/admin/users",
    test: target,
    exp: Date.now() + OIDC_STATE_MAX_AGE * 1000,
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: await oidcCallbackUrl(),
    scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: state.state,
    nonce: state.nonce,
    // Another person than the one signed in at the IdP (most likely the admin):
    // ask for a fresh login, with the name filled in.
    ...(target.loginHint && { login_hint: target.loginHint, prompt: "login" }),
  });
  return { url, cookie: await sealState(state) };
}

const errorCode = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_.\-]{1,64}$/.test(value) ? value : null;

function display(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

// From the callback: reads what the IdP sent and keeps the result. Returns
// the result's id.
export async function finishTestLogin(search: string, state: LoginState, target: OidcTestTarget): Promise<string> {
  const fail = (reason: OidcTestFailure, idpError: string | null = null) =>
    keep(target.adminUserId, { ok: false, reason, idpError });

  let config: client.Configuration;
  try {
    config = await discoverWith({ issuer: target.issuer, clientId: target.clientId, clientSecret: target.clientSecret });
  } catch (err) {
    console.error("[oidc] test: discovery failed", err);
    return fail("unavailable");
  }
  const currentUrl = new URL(`${await oidcCallbackUrl()}${search}`);
  let idClaims: client.IDToken;
  let accessToken: string;
  try {
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: state.verifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    });
    idClaims = tokens.claims()!;
    accessToken = tokens.access_token;
  } catch (err) {
    const idpError = errorCode(currentUrl.searchParams.get("error"));
    if (idpError === "access_denied") return fail("cancelled", idpError);
    console.error("[oidc] test: sign-in failed", err);
    return fail("failed", idpError ?? errorCode((err as { error?: unknown }).error));
  }

  const { claims, userInfo, info } = await profileClaims(config, idClaims, accessToken);
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
  const keys = [...new Set([...Object.keys(idClaims), ...Object.keys(info ?? {})])].filter((k) => !PROTOCOL_CLAIMS.has(k));
  const sourceOf = (key: string) =>
    key in idClaims && info && key in info ? "both" : info && key in info ? "userInfo" : "idToken";
  const nameClaims = nameTemplateClaims(target.nameClaim || null);
  const displayName = renderDisplayName(target.nameClaim || null, claims);
  // With the default, only "name" or "preferred_username" is needed.
  const missingNameClaims = nameClaims.filter((c) => !hasClaimText(claims, c));
  return keep(target.adminUserId, {
    ok: true,
    loginHint: target.loginHint,
    subject: idClaims.sub,
    email,
    emailVerified: claims.email_verified === true,
    userInfo,
    nameSetting: target.nameClaim,
    displayName,
    missingNameClaims: displayName === null || target.nameClaim ? missingNameClaims : [],
    groupsClaim: target.groupsClaim,
    groups: target.groupsClaim ? groupNames(claims as Claims, target.groupsClaim) : null,
    claims: keys.slice(0, MAX_CLAIMS).map((name) => ({ name, value: display(claims[name]), source: sourceOf(name) })),
  });
}
