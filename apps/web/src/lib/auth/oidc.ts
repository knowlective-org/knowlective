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
import { prisma } from "@/lib/db";
import { emailColumns, emailWhere } from "@/lib/emails";
import { recordAudit } from "@/lib/audit";
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
  newUserRole: OidcRole;
  allowedDomains: string[];
  trustEmail: boolean;
  passwordLogin: PasswordLoginMode;
};

const DEFAULTS: OidcSettingsView = {
  configured: false,
  enabled: false,
  issuer: "",
  clientId: "",
  hasSecret: false,
  buttonLabel: "シングルサインオン",
  nameClaim: "",
  newUserRole: "USER",
  allowedDomains: [],
  trustEmail: false,
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
    newUserRole: isOidcRole(row.newUserRole) ? row.newUserRole : "USER",
    allowedDomains: row.allowedDomains,
    trustEmail: row.trustEmail,
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

type LoginState = {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
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
): Promise<{ url: URL; cookie: string } | null> {
  const config = await discover();
  if (!config) return null;
  const verifier = client.randomPKCECodeVerifier();
  const state: LoginState = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier,
    next,
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

// Why a sign-in failed. The callback redirects to /login?sso_error=<code>
// and the login page shows OIDC_ERROR_MESSAGES[code] — never text from the
// URL, which anyone could craft.
export const OIDC_ERROR_MESSAGES = {
  unavailable: "シングルサインオンは現在使えません。",
  expired: "ログインの有効期限が切れました。もう一度お試しください。",
  cancelled: "ログインがキャンセルされました。",
  failed:
    "シングルサインオンでのログインに失敗しました。もう一度お試しください。",
  disabled:
    "このアカウントは無効になっています。管理者に問い合わせてください。",
  no_email:
    "IdP から確認済みのメールアドレスを受け取れなかったため、ログインできません。管理者に問い合わせてください。",
  domain:
    "このメールアドレスのドメインでは、アカウントを作成できません。管理者に問い合わせてください。",
  conflict:
    "このメールアドレスのアカウントは、別の IdP アカウントと結び付いています。管理者に問い合わせてください。",
} as const;
export type OidcErrorCode = keyof typeof OIDC_ERROR_MESSAGES;

export class OidcLoginError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

// Completes the sign-in from the callback's query string. Returns the user
// to sign in and where to go next.
export async function finishLogin(
  search: string,
  stateCookie: string | undefined,
): Promise<{ userId: string; next: string }> {
  const settings = await prisma.oidcSettings.findUnique({ where: { id: 1 } });
  const config = await discover();
  if (!settings?.enabled || !config) throw new OidcLoginError("unavailable");
  const state = await openState(stateCookie);
  if (!state) throw new OidcLoginError("expired");

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
    return { userId: existing.id, next: state.next };
  }

  // 3. New account, with the subject stored from the start.
  if (!isDomainAllowed(email, settings.allowedDomains)) {
    throw new OidcLoginError("domain");
  }
  const name = await displayName(
    config,
    settings.nameClaim,
    claims,
    accessToken,
  );
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
  await prisma.$transaction((tx) => ensurePersonalRoot(tx, user.id));
  await recordAudit(
    { userId: user.id, label: name ? `${name}（${email}）` : email },
    "user.create.oidc",
    `シングルサインオンで ${email} のアカウントを作成（${role === "CONTENT_MANAGER" ? "コンテンツ管理者" : "一般ユーザー"}）`,
    { userId: user.id, issuer },
  );
  return { userId: user.id, next: state.next };
}

// A claim's value as a display name: strings only, trimmed, at most 100
// characters. `path` may be dotted for nested claims (e.g. "profile.name").
function claimText(
  claims: Record<string, unknown>,
  path: string,
): string | null {
  let value: unknown = claims;
  for (const key of path.split(".")) {
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 100)
    : null;
}

// Display name for a new account: the configured claim (from the ID token,
// else the UserInfo endpoint), or by default "name" then "preferred_username".
async function displayName(
  config: client.Configuration,
  nameClaim: string | null,
  claims: client.IDToken,
  accessToken: string,
): Promise<string | null> {
  const paths = nameClaim ? [nameClaim] : ["name", "preferred_username"];
  for (const path of paths) {
    const value = claimText(claims, path);
    if (value) return value;
  }
  if (!config.serverMetadata().userinfo_endpoint) return null;
  try {
    const info = await client.fetchUserInfo(config, accessToken, claims.sub);
    for (const path of paths) {
      const value = claimText(info, path);
      if (value) return value;
    }
  } catch (err) {
    // A display name isn't worth failing the sign-in for.
    console.error("[oidc] UserInfo request failed", err);
  }
  return null;
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
