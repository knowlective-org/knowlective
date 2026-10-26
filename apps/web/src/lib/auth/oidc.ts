import { randomBytes } from "node:crypto";
import * as client from "openid-client";
import {
  decrypt,
  encrypt,
  hashPassword,
  loadDataKey,
  type PasswordLoginMode,
  type SiteRole,
  ensurePersonalRoot,
} from "shared";
import { withBasePath } from "@/lib/base-path";
import { prisma } from "@/lib/db";
import { emailColumns, emailWhere, withEmail } from "@/lib/emails";
import { type Claims, groupNames, renderDisplayName, syncOidcGroups } from "./oidc-profile";
import { recordAudit, userLabel } from "@/lib/audit";
import { auditTranslator } from "@/i18n/audit";
import { getTranslations } from "next-intl/server";
import { isDomainAllowed } from "@/lib/auth/signup";
import { getPublicUrl } from "@/lib/site-url";

// Sign-in with OpenID Connect (authorization code flow with PKCE, state and
// nonce; client authenticated with its secret). The protocol work — discovery,
// token request, ID token signature/issuer/audience/expiry/nonce checks — is
// done by openid-client (a certified implementation); this module decides
// who the person is in knowlective:
//
// 1. A user whose oidcIssuer + oidcSubject match → that user.
// 2. Otherwise a verified email matching an account not yet linked to any
//    IdP account → store the subject on it, sign in.
// 3. Otherwise, if the email domain is allowed → create an account (the
//    configured role and display-name claim, no groups) with the subject.
//
// "Verified" means email_verified: true, or the admin's trustEmail setting
// for IdPs that don't send it but control their users' addresses.

export const OIDC_CALLBACK_PATH = "/auth/oidc/callback";
export const OIDC_START_PATH = "/auth/oidc/start";
export const OIDC_STATE_COOKIE = "knowlective_oidc";
// The state cookie's Path (covers the callback).
export const OIDC_STATE_COOKIE_PATH = "/auth/oidc";
export const OIDC_STATE_MAX_AGE = 10 * 60;
const STATE_AAD = "knowlective:oidc-login-state";
const SECRET_AAD = "knowlective:oidc-client-secret";

export const OIDC_ROLES = [
  "USER",
  "CONTENT_MANAGER",
] as const satisfies readonly SiteRole[];
export type OidcRole = (typeof OIDC_ROLES)[number];
export const isOidcRole = (v: unknown): v is OidcRole =>
  OIDC_ROLES.includes(v as OidcRole);

export type OidcSettingsView = {
  configured: boolean;
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  buttonLabel: string;
  nameClaim: string;
  syncName: boolean;
  groupsClaim: string;
  newUserRole: OidcRole;
  allowedDomains: string[];
  trustEmail: boolean;
  allowNameChange: boolean;
  passwordLogin: PasswordLoginMode;
};

const DEFAULTS: OidcSettingsView = {
  configured: false,
  enabled: false,
  issuer: "",
  clientId: "",
  hasSecret: false,
  // Empty: the login screen's own name for it, in the viewer's language.
  buttonLabel: "",
  nameClaim: "",
  syncName: true,
  groupsClaim: "",
  newUserRole: "USER",
  allowedDomains: [],
  trustEmail: false,
  allowNameChange: false,
  passwordLogin: "ALLOWED",
};

export async function getOidcSettings(): Promise<OidcSettingsView> {
  const row = await prisma.oidcSettings.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULTS;
  return {
    configured: true,
    enabled: row.enabled,
    issuer: row.issuer,
    clientId: row.clientId,
    hasSecret: row.clientSecretEnc.length > 0,
    buttonLabel: row.buttonLabel,
    nameClaim: row.nameClaim ?? "",
    syncName: row.syncName,
    groupsClaim: row.groupsClaim ?? "",
    newUserRole: isOidcRole(row.newUserRole) ? row.newUserRole : "USER",
    allowedDomains: row.allowedDomains,
    trustEmail: row.trustEmail,
    allowNameChange: row.allowNameChange,
    passwordLogin: row.passwordLogin,
  };
}

export async function sealClientSecret(
  secret: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(
    encrypt(await loadDataKey(prisma), Buffer.from(secret, "utf8"), SECRET_AAD),
  );
}

export async function oidcCallbackUrl(): Promise<string> {
  return `${await getPublicUrl()}${OIDC_CALLBACK_PATH}`;
}

// Discovery result per settings version, so the IdP isn't asked on every
// sign-in. openid-client caches the IdP's signing keys on the Configuration.
let cached: { key: string; at: number; config: client.Configuration } | null =
  null;
const CACHE_MS = 10 * 60 * 1000;

// openid-client refuses plain http; allowed only for an IdP on this machine
// (development). The admin form rejects other http issuers.
function discoveryOptions(issuer: URL) {
  const local =
    issuer.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(issuer.hostname);
  return local ? { execute: [client.allowInsecureRequests] } : undefined;
}

// Unsaved settings (the admin's connection test / save).
export function discoverWith(settings: {
  issuer: string;
  clientId: string;
  clientSecret: string;
}) {
  const issuer = new URL(settings.issuer);
  return client.discovery(
    issuer,
    settings.clientId,
    settings.clientSecret,
    undefined,
    discoveryOptions(issuer),
  );
}

// The saved, enabled settings' IdP configuration, or null.
export async function discover() {
  const row = await prisma.oidcSettings.findUnique({ where: { id: 1 } });
  if (!row?.enabled) return null;
  const key = `${row.issuer}|${row.clientId}|${row.updatedAt.getTime()}`;
  if (cached?.key === key && Date.now() - cached.at < CACHE_MS)
    return cached.config;
  const secret = decrypt(
    await loadDataKey(prisma),
    row.clientSecretEnc,
    SECRET_AAD,
  ).toString("utf8");
  const config = await discoverWith({
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecret: secret,
  });
  cached = { key, at: Date.now(), config };
  return config;
}

// ---- login state cookie -----------------------------------------------------
// Encrypted (it holds the PKCE verifier) and short-lived.

// Where the sign-in was started: the app's login page, or the admin
// console's (which signs in to the admin console instead, still with TOTP).
export type OidcPurpose = "app" | "admin";

type LoginState = {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  purpose?: OidcPurpose;
  exp: number;
};

async function sealState(state: LoginState): Promise<string> {
  const sealed = encrypt(
    await loadDataKey(prisma),
    Buffer.from(JSON.stringify(state), "utf8"),
    STATE_AAD,
  );
  return Buffer.from(sealed).toString("base64url");
}

async function openState(
  cookie: string | undefined,
): Promise<LoginState | null> {
  if (!cookie) return null;
  try {
    const state = JSON.parse(
      decrypt(
        await loadDataKey(prisma),
        Buffer.from(cookie, "base64url"),
        STATE_AAD,
      ).toString("utf8"),
    ) as LoginState;
    return state.exp > Date.now() ? state : null;
  } catch {
    return null;
  }
}

// The IdP URL to send the browser to, and the cookie to set alongside.
export async function beginLogin(
  next: string,
  purpose: OidcPurpose = "app",
): Promise<{ url: URL; cookie: string } | null> {
  const config = await discover();
  if (!config) return null;
  const verifier = client.randomPKCECodeVerifier();
  const state: LoginState = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier,
    next,
    purpose,
    exp: Date.now() + OIDC_STATE_MAX_AGE * 1000,
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: await oidcCallbackUrl(),
    scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: state.state,
    nonce: state.nonce,
  });
  return { url, cookie: await sealState(state) };
}

// The Set-Cookie header for beginLogin()'s cookie. Only the callback needs
// it. Lax: sent on the IdP's top-level redirect back.
export function stateCookieHeader(value: string, secure: boolean): string {
  return [
    `${OIDC_STATE_COOKIE}=${value}`,
    `Path=${withBasePath(OIDC_STATE_COOKIE_PATH)}`,
    `Max-Age=${OIDC_STATE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

// Why a sign-in failed. The callback redirects to /login?sso_error=<code>
// and the login page shows its own text for the code (login.ssoErrors) —
// never text from the URL, which anyone could craft.
export const OIDC_ERROR_CODES = [
  "unavailable",
  "expired",
  "cancelled",
  "failed",
  "disabled",
  "no_email",
  "domain",
  "conflict",
  "not_admin",
] as const;
export type OidcErrorCode = (typeof OIDC_ERROR_CODES)[number];

export function isOidcErrorCode(value: unknown): value is OidcErrorCode {
  return typeof value === "string" && (OIDC_ERROR_CODES as readonly string[]).includes(value);
}

export class OidcLoginError extends Error {
  // Which login page to send the error back to (set by finishLogin()).
  purpose: OidcPurpose = "app";
  constructor(
    readonly code: OidcErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

// Completes the sign-in from the callback's query string. Returns the user
// to sign in, where to go next, and where the sign-in was started.
export async function finishLogin(
  search: string,
  stateCookie: string | undefined,
): Promise<{ userId: string; next: string; purpose: OidcPurpose }> {
  const state = await openState(stateCookie);
  const purpose = state?.purpose ?? "app";
  try {
    if (!state) throw new OidcLoginError("expired");
    return { ...(await completeLogin(search, state)), purpose };
  } catch (err) {
    if (err instanceof OidcLoginError) err.purpose = purpose;
    throw err;
  }
}

async function completeLogin(search: string, state: LoginState): Promise<{ userId: string; next: string }> {
  const settings = await prisma.oidcSettings.findUnique({ where: { id: 1 } });
  const config = await discover();
  if (!settings?.enabled || !config) throw new OidcLoginError("unavailable");

  // The URL the IdP redirected to, rebuilt from the public URL (behind a
  // proxy the request's own URL may not be what was registered).
  const currentUrl = new URL(`${await oidcCallbackUrl()}${search}`);
  let claims: client.IDToken;
  let accessToken: string;
  try {
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: state.verifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims()!;
    accessToken = tokens.access_token;
  } catch (err) {
    const idpError = currentUrl.searchParams.get("error");
    if (idpError === "access_denied") throw new OidcLoginError("cancelled");
    throw new OidcLoginError("failed", String(err));
  }

  const issuer = claims.iss;
  const subject = claims.sub;
  const profile = await profileClaims(config, claims, accessToken);
  const email =
    typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
  const emailVerified = claims.email_verified === true || settings.trustEmail;

  // 1. Linked before (User.oidcIssuer + oidcSubject).
  const linked = await prisma.user.findUnique({
    where: {
      oidcIssuer_oidcSubject: { oidcIssuer: issuer, oidcSubject: subject },
    },
    select: { id: true, disabledAt: true },
  });
  if (linked) {
    if (linked.disabledAt) throw new OidcLoginError("disabled");
    await applyProfile(linked.id, settings, profile);
    return { userId: linked.id, next: state.next };
  }

  if (!email || !emailVerified) {
    throw new OidcLoginError("no_email");
  }

  // 2. Existing account with this (verified) email: store the subject on it
  // (first sign-in through the IdP).
  const existing = await prisma.user.findUnique({
    where: await emailWhere(email),
    select: { id: true, disabledAt: true, oidcIssuer: true, oidcSubject: true },
  });
  if (existing) {
    if (existing.disabledAt) throw new OidcLoginError("disabled");
    // Already tied to a different IdP account: don't let another one take it
    // over just because it reports the same email.
    if (existing.oidcSubject !== null) throw new OidcLoginError("conflict");
    await prisma.user.update({
      where: { id: existing.id },
      data: { oidcIssuer: issuer, oidcSubject: subject },
    });
    await applyProfile(existing.id, settings, profile);
    return { userId: existing.id, next: state.next };
  }

  // 3. New account, with the subject stored from the start.
  if (!isDomainAllowed(email, settings.allowedDomains)) {
    throw new OidcLoginError("domain");
  }
  const name = renderDisplayName(settings.nameClaim, profile.claims);
  const role: OidcRole = isOidcRole(settings.newUserRole)
    ? settings.newUserRole
    : "USER";
  // No usable password: this account signs in through the IdP.
  const passwordHash = await hashPassword(
    randomBytes(48).toString("base64url"),
  );
  const user = await prisma.user.create({
    data: {
      ...(await emailColumns(email)),
      name,
      passwordHash,
      siteRole: role,
      oidcIssuer: issuer,
      oidcSubject: subject,
    },
  });
  // Every person's account comes with its own personal knowledge root.
  const title = (await getTranslations("account"))("personalRootTitle");
  await prisma.$transaction((tx) => ensurePersonalRoot(tx, user.id, title));
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel({ name, email }) },
    "user.create.oidc",
    audit("audit.oidcUserCreated", { email, role: audit(`roles.${role}`) }),
    { userId: user.id, issuer },
  );
  // Its groups (the name is set already).
  await applyProfile(user.id, { ...settings, syncName: false }, profile);
  return { userId: user.id, next: state.next };
}

// The claims to read the profile from: the ID token's, with the UserInfo
// endpoint's over them (when the IdP has one). `userInfo`: whether UserInfo
// was read (a failed request mustn't look like "no groups").
async function profileClaims(
  config: client.Configuration,
  claims: client.IDToken,
  accessToken: string,
): Promise<{ claims: Claims; userInfo: boolean | null }> {
  if (!config.serverMetadata().userinfo_endpoint) return { claims, userInfo: null };
  try {
    const info = await client.fetchUserInfo(config, accessToken, claims.sub);
    return { claims: { ...claims, ...info }, userInfo: true };
  } catch (err) {
    console.error("[oidc] UserInfo request failed", err);
    return { claims, userInfo: false };
  }
}

// At every sign-in of an account linked to the IdP: the display name again
// (OidcSettings.syncName) and the groups (groupsClaim).
async function applyProfile(
  userId: string,
  settings: { nameClaim: string | null; syncName: boolean; groupsClaim: string | null },
  profile: { claims: Claims; userInfo: boolean | null },
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, emailEnc: true } });
  let name = user.name;
  if (settings.syncName) {
    const fresh = renderDisplayName(settings.nameClaim, profile.claims);
    if (fresh && fresh !== user.name) {
      await prisma.user.update({ where: { id: userId }, data: { name: fresh } });
      name = fresh;
    }
  }
  if (settings.groupsClaim) {
    const names = groupNames(profile.claims, settings.groupsClaim);
    // Not there because UserInfo couldn't be read: leave the groups as they are.
    if (names === null && profile.userInfo === false) return;
    const { email } = await withEmail(user);
    await syncOidcGroups(prisma, { id: userId, label: `${userLabel({ name, email })} (SSO)` }, names ?? []);
  }
}

// Password sign-in is allowed for this user under the current settings.
export async function passwordLoginAllowed(
  siteRole: SiteRole,
): Promise<boolean> {
  const row = await prisma.oidcSettings.findUnique({
    where: { id: 1 },
    select: { enabled: true, passwordLogin: true },
  });
  if (!row?.enabled || row.passwordLogin === "ALLOWED") return true;
  return siteRole === "SITE_ADMIN";
}
