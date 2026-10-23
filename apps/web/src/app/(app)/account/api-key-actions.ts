"use server";

import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { recordAudit, userLabel } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  API_KEY_EXPIRY_DAYS,
  MAX_API_KEY_NAME_LENGTH,
  canIssueApiKeys,
  createApiKey,
  isApiKeyScope,
  listApiKeys,
} from "@/lib/api/keys";
import { beginReauthentication } from "@/lib/auth/passkeys";
import { verifyReauth } from "@/lib/auth/reauth";
import { LOCK_WINDOW_MS, getSessionUser, requireUser } from "@/lib/auth/session";

// The signed-in user's own API keys (account screen). Issuing one needs the
// API on, a role that may hold keys, and confirming who they are again
// (lib/auth/reauth.ts): a key outlives the session it was made in.

// The passkey prompt's options, for confirming with a passkey.
export async function beginApiKeyPasskeyCheck(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const user = await requireUser("/account");
  return beginReauthentication(user);
}

export type IssueApiKeyInput = {
  name: string;
  scope: string;
  // Days, or null for no expiry.
  expiresInDays: number | null;
  password?: string;
  passkey?: AuthenticationResponseJSON;
};

export async function issueApiKey(input: IssueApiKeyInput): Promise<{ key: string } | { error: string }> {
  const user = await requireUser("/account");
  const session = (await getSessionUser())!.session;
  const t = await getTranslations("account.apiKeys.errors");
  if (!(await canIssueApiKeys(user.siteRole))) return { error: t("notAllowed") };
  const name = typeof input?.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: t("nameRequired") };
  if (name.length > MAX_API_KEY_NAME_LENGTH) return { error: t("nameTooLong", { max: MAX_API_KEY_NAME_LENGTH }) };
  if (!isApiKeyScope(input.scope)) return { error: t("invalid") };
  const expiresInDays = input.expiresInDays;
  if (expiresInDays !== null && !API_KEY_EXPIRY_DAYS.includes(expiresInDays as (typeof API_KEY_EXPIRY_DAYS)[number])) {
    return { error: t("invalid") };
  }

  const confirmed = await verifyReauth(user, session, { password: input.password, passkey: input.passkey });
  if (confirmed === "locked") return { error: t("locked", { minutes: LOCK_WINDOW_MS / 60000 }) };
  if (confirmed !== "ok") return { error: t("notConfirmed") };

  const { id, key } = await createApiKey(user.id, { name, scope: input.scope, expiresInDays });
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "user.apikey.create",
    audit("audit.apiKeyCreate", { name, scope: input.scope, days: expiresInDays === null ? "none" : String(expiresInDays) }),
    { apiKeyId: id, scope: input.scope, expiresInDays },
  );
  revalidatePath("/account");
  return { key };
}

// Revoking needs no confirmation: it only takes access away.
export async function revokeApiKey(apiKeyId: string): Promise<{ error?: string }> {
  const user = await requireUser("/account");
  const key = (await listApiKeys(user.id)).find((k) => k.id === apiKeyId);
  if (!key) return { error: (await getTranslations("account.apiKeys.errors"))("notFound") };
  await prisma.apiKey.deleteMany({ where: { id: apiKeyId, userId: user.id } });
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "user.apikey.revoke",
    audit("audit.apiKeyRevoke", { name: key.name }),
    { apiKeyId },
  );
  revalidatePath("/account");
  return {};
}
