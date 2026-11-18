import { createHash, randomBytes } from "node:crypto";
import type { ApiKeyScope, SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { getApiSettings } from "@/lib/api/keys";
import { pkceMatches, scopeString } from "./params";

// Authorization codes, tokens and grants of the OAuth authorization server
// (lib/oauth/). A grant is one person's consent to one app; its tokens act
// as that person on the MCP server, like an API key, and stop working the
// moment any of these no longer holds: the API and the MCP server are on,
// the person isn't disabled, their role is among apiKeyRoles, the grant
// exists (revoking it on the account screen deletes it).
//
// Codes and tokens are random strings; only their SHA-256 is stored.
// Refresh tokens rotate: each use gives a new one, and presenting a used one
// again ends the grant (someone else has a copy).

export const ACCESS_TOKEN_PREFIX = "kna_";
const REFRESH_TOKEN_PREFIX = "knr_";
const CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TOKEN_TTL_S = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Don't write lastUsedAt on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = (prefix: string) => prefix + randomBytes(32).toString("base64url");

// Whether people with this role may connect apps now.
export async function oauthAllowedFor(siteRole: SiteRole): Promise<boolean> {
  const [settings, config] = await Promise.all([
    getApiSettings(),
    prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { mcpEnabled: true } }),
  ]);
  return settings.enabled && !!config?.mcpEnabled && settings.roles.includes(siteRole);
}

async function userStillAllowed(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true, siteRole: true } });
  return !!user && !user.disabledAt && (await oauthAllowedFor(user.siteRole));
}

// The person agreed: a new grant, and the code the app exchanges for tokens.
export async function createAuthorization(input: {
  userId: string;
  clientId: string;
  write: boolean;
  redirectUri: string;
  codeChallenge: string;
}): Promise<{ code: string; grantId: string }> {
  const code = secret("");
  const grant = await prisma.oAuthGrant.create({
    data: {
      userId: input.userId,
      clientId: input.clientId,
      scope: input.write ? "WRITE" : "READ",
      codes: {
        create: {
          codeHash: hash(code),
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      },
    },
    select: { id: true },
  });
  await prisma.oAuthClient.update({ where: { id: input.clientId }, data: { lastUsedAt: new Date() } });
  return { code, grantId: grant.id };
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type TokenError = { error: "invalid_grant" | "invalid_request"; error_description: string };

const invalidGrant = (description: string): TokenError => ({ error: "invalid_grant", error_description: description });

async function issueTokens(grant: { id: string; scope: ApiKeyScope }): Promise<TokenResponse> {
  const access = secret(ACCESS_TOKEN_PREFIX);
  const refresh = secret(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  await prisma.oAuthToken.createMany({
    data: [
      { tokenHash: hash(access), grantId: grant.id, kind: "ACCESS", expiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000) },
      { tokenHash: hash(refresh), grantId: grant.id, kind: "REFRESH", expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS) },
    ],
  });
  // Expired codes and tokens are of no use to anyone.
  await Promise.all([
    prisma.oAuthToken.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
    prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: new Date(now - CODE_TTL_MS) } } }),
    // Grants whose code was never exchanged, or whose tokens have all expired.
    prisma.oAuthGrant.deleteMany({ where: { tokens: { none: {} }, createdAt: { lt: new Date(now - 2 * CODE_TTL_MS) } } }),
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refresh, scope: scopeString(grant.scope === "WRITE") };
}

// The token endpoint, grant_type=authorization_code.
export async function exchangeCode(input: {
  clientId: unknown;
  code: unknown;
  redirectUri: unknown;
  codeVerifier: unknown;
}): Promise<TokenResponse | TokenError> {
  if (typeof input.code !== "string" || typeof input.clientId !== "string" || typeof input.redirectUri !== "string") {
    return { error: "invalid_request", error_description: "code, client_id and redirect_uri are required." };
  }
  const row = await prisma.oAuthCode.findUnique({
    where: { codeHash: hash(input.code) },
    include: { grant: { select: { id: true, clientId: true, userId: true, scope: true } } },
  });
  if (!row) return invalidGrant("The code is invalid.");
  if (row.usedAt) {
    // A code used twice: whatever was issued with it may be in the wrong hands.
    await prisma.oAuthGrant.deleteMany({ where: { id: row.grantId } });
    return invalidGrant("The code was already used.");
  }
  if (row.expiresAt.getTime() <= Date.now()) return invalidGrant("The code has expired.");
  if (row.grant.clientId !== input.clientId) return invalidGrant("The code was issued to another client.");
  if (row.redirectUri !== input.redirectUri) return invalidGrant("redirect_uri doesn't match the authorization request.");
  if (!pkceMatches(input.codeVerifier, row.codeChallenge)) return invalidGrant("code_verifier doesn't match the code challenge.");
  // Once: of two requests at the same moment, only one gets here.
  const marked = await prisma.oAuthCode.updateMany({ where: { codeHash: row.codeHash, usedAt: null }, data: { usedAt: new Date() } });
  if (marked.count !== 1) return invalidGrant("The code was already used.");
  if (!(await userStillAllowed(row.grant.userId))) return invalidGrant("The account can't connect apps.");
  return issueTokens(row.grant);
}

// The token endpoint, grant_type=refresh_token.
export async function refreshTokens(input: { clientId: unknown; refreshToken: unknown }): Promise<TokenResponse | TokenError> {
  if (typeof input.refreshToken !== "string" || typeof input.clientId !== "string") {
    return { error: "invalid_request", error_description: "refresh_token and client_id are required." };
  }
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hash(input.refreshToken) },
    include: { grant: { select: { id: true, clientId: true, userId: true, scope: true } } },
  });
  if (!row || row.kind !== "REFRESH") return invalidGrant("The refresh token is invalid.");
  if (row.grant.clientId !== input.clientId) return invalidGrant("The refresh token was issued to another client.");
  if (row.usedAt) {
    await prisma.oAuthGrant.deleteMany({ where: { id: row.grantId } });
    return invalidGrant("The refresh token was already used; the connection has been ended.");
  }
  if (row.expiresAt.getTime() <= Date.now()) return invalidGrant("The refresh token has expired.");
  const marked = await prisma.oAuthToken.updateMany({ where: { tokenHash: row.tokenHash, usedAt: null }, data: { usedAt: new Date() } });
  if (marked.count !== 1) return invalidGrant("The refresh token was already used.");
  if (!(await userStillAllowed(row.grant.userId))) return invalidGrant("The account can't connect apps.");
  await prisma.oAuthGrant.update({ where: { id: row.grantId }, data: { lastUsedAt: new Date() } });
  return issueTokens(row.grant);
}

// The revocation endpoint (RFC 7009): a refresh token ends its grant, an
// access token only itself. Unknown tokens are no error.
export async function revokeToken(token: unknown, clientId: unknown): Promise<void> {
  if (typeof token !== "string") return;
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: hash(token) }, include: { grant: { select: { clientId: true } } } });
  if (!row || (typeof clientId === "string" && row.grant.clientId !== clientId)) return;
  if (row.kind === "REFRESH") await prisma.oAuthGrant.deleteMany({ where: { id: row.grantId } });
  else await prisma.oAuthToken.deleteMany({ where: { tokenHash: row.tokenHash } });
}

export type OAuthCaller = { userId: string; siteRole: SiteRole; scope: ApiKeyScope; grantId: string; clientId: string };

// An access token on the MCP server: who it acts as, or null.
export async function authenticateAccessToken(token: string): Promise<OAuthCaller | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { grant: { include: { user: { select: { id: true, siteRole: true, disabledAt: true } } } } },
  });
  if (!row || row.kind !== "ACCESS" || row.expiresAt.getTime() <= Date.now()) return null;
  const { grant } = row;
  if (grant.user.disabledAt || !(await oauthAllowedFor(grant.user.siteRole))) return null;
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } });
  }
  return { userId: grant.user.id, siteRole: grant.user.siteRole, scope: grant.scope, grantId: grant.id, clientId: grant.clientId };
}

export type GrantView = {
  id: string;
  clientName: string;
  // A registered app's id, or the URL of its metadata document.
  clientId: string;
  scope: ApiKeyScope;
  createdAt: Date;
  lastUsedAt: Date | null;
};

// The apps a person has connected (the account screen).
export async function listGrants(userId: string): Promise<GrantView[]> {
  const rows = await prisma.oAuthGrant.findMany({
    where: { userId, tokens: { some: {} } },
    orderBy: { createdAt: "desc" },
    include: { client: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    clientName: r.client.name,
    clientId: r.client.id,
    scope: r.scope,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

// Ends one of the person's own connections; its tokens stop working at once.
// Returns the app's name for the record, or null when there was none.
export async function revokeGrant(userId: string, grantId: unknown): Promise<{ clientName: string } | null> {
  if (typeof grantId !== "string") return null;
  const grant = await prisma.oAuthGrant.findFirst({ where: { id: grantId, userId }, include: { client: { select: { name: true } } } });
  if (!grant) return null;
  await prisma.oAuthGrant.delete({ where: { id: grant.id } });
  return { clientName: grant.client.name };
}
