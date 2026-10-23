import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type ApiKeyScope, type SiteRole, decrypt, encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { withEmail } from "@/lib/emails";

// Personal API keys (the public API, /api/v1). A request with a key acts as
// the key's owner: the owner's page permissions, never more, and a READ key
// only reads. Only the key's SHA-256 hash is stored; the key itself is shown
// once, when issued.
//
// A key works only while all of these hold, checked on every request:
// - the API is on (InstanceConfig.apiEnabled);
// - the key hasn't expired and hasn't been revoked (deleted);
// - its owner isn't disabled, and their role may hold keys (apiKeyRoles).

export const API_KEY_PREFIX = "kn_";
// Shown in lists to tell keys apart: "kn_" and the first characters.
const SHOWN_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;
export const MAX_API_KEY_NAME_LENGTH = 60;
export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const;
export const API_KEY_SCOPES = ["READ", "WRITE"] as const satisfies readonly ApiKeyScope[];
export const isApiKeyScope = (v: unknown): v is ApiKeyScope => API_KEY_SCOPES.includes(v as ApiKeyScope);
// Don't write lastUsedAt on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function apiKeyNameAad(id: string): string {
  return `knowlective:api-key-name:${id}`;
}

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export type ApiSettings = { enabled: boolean; roles: SiteRole[] };

export async function getApiSettings(): Promise<ApiSettings> {
  const config = await prisma.instanceConfig.findUnique({
    where: { id: 1 },
    select: { apiEnabled: true, apiKeyRoles: true },
  });
  return { enabled: config?.apiEnabled ?? false, roles: config?.apiKeyRoles ?? [] };
}

export async function canIssueApiKeys(siteRole: SiteRole): Promise<boolean> {
  const settings = await getApiSettings();
  return settings.enabled && settings.roles.includes(siteRole);
}

// A new key for `userId`. Whether they may have one (and confirmed who they
// are) is for the caller. Returns the key itself: the only time it's known.
export async function createApiKey(
  userId: string,
  input: { name: string; scope: ApiKeyScope; expiresInDays: number | null },
): Promise<{ id: string; key: string }> {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  const id = randomUUID();
  await prisma.apiKey.create({
    data: {
      id,
      userId,
      tokenHash: hashKey(key),
      prefix: key.slice(0, SHOWN_PREFIX_LENGTH),
      nameEnc: Uint8Array.from(
        encrypt(await loadDataKey(prisma), Buffer.from(input.name, "utf8"), apiKeyNameAad(id)),
      ),
      scope: input.scope,
      expiresAt: input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * 86_400_000),
    },
  });
  return { id, key };
}

export type ApiKeyView = {
  id: string;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
};

export async function listApiKeys(userId: string): Promise<ApiKeyView[]> {
  const rows = await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const dataKey = await loadDataKey(prisma);
  return rows.map((r) => ({
    id: r.id,
    name: decrypt(dataKey, r.nameEnc, apiKeyNameAad(r.id)).toString("utf8"),
    prefix: r.prefix,
    scope: r.scope,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

export type ApiCaller = {
  user: { id: string; name: string | null; email: string; siteRole: SiteRole };
  key: { id: string; scope: ApiKeyScope; expiresAt: Date | null };
};

// Why a request's key isn't accepted. The same "invalid_key" for every
// problem with the key or its owner, so a key can't be probed for which one.
export type ApiAuthError = "api_disabled" | "missing_key" | "invalid_key";

export async function authenticateApiKey(authorization: string | null): Promise<ApiCaller | { error: ApiAuthError }> {
  if (!(await getApiSettings()).enabled) return { error: "api_disabled" };
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return { error: "missing_key" };
  const key = match[1];
  if (!key.startsWith(API_KEY_PREFIX)) return { error: "invalid_key" };
  const row = await prisma.apiKey.findUnique({
    where: { tokenHash: hashKey(key) },
    include: { user: { select: { id: true, name: true, emailEnc: true, siteRole: true, disabledAt: true } } },
  });
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now()) || row.user.disabledAt) {
    return { error: "invalid_key" };
  }
  if (!(await getApiSettings()).roles.includes(row.user.siteRole)) return { error: "invalid_key" };
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  const { id, name, email, siteRole } = await withEmail(row.user);
  return { user: { id, name, email, siteRole }, key: { id: row.id, scope: row.scope, expiresAt: row.expiresAt } };
}
