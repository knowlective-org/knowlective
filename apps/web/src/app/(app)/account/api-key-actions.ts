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
import { CODE_TTL_MINUTES, sendEmailCode } from "@/lib/auth/email-code";
import { beginReauthentication } from "@/lib/auth/passkeys";
import { reauthMethod, verifyReauth } from "@/lib/auth/reauth";
import { requireUser } from "@/lib/auth/session";

// The signed-in user's own API keys (account screen). Issuing one needs the
// API on, a role that may hold keys, and confirming who they are again
// (lib/auth/reauth.ts: their passkey, or else a code mailed to them): a key
// outlives the session it was made in.

// The passkey prompt's options, for confirming with a passkey.
export async function beginApiKeyPasskeyCheck(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const user = await requireUser("/account");
  return beginReauthentication(user);
}

// Mails a confirmation code, for an account without a passkey.
export async function sendApiKeyCode(): Promise<{ sentTo: string; ttlMinutes: number } | { error: string }> {
  const user = await requireUser("/account");
  const t = await getTranslations("account.apiKeys.errors");
  if (!(await canIssueApiKeys(user.siteRole))) return { error: t("notAllowed") };
  if ((await reauthMethod(user.id)) !== "code") return { error: t("invalid") };
  try {
    if ((await sendEmailCode(user, "api-key")) === "tooMany") return { error: t("tooManyCodes") };
  } catch (err) {
    console.error("[api keys] sending the confirmation code failed", err);
    return { error: t("mailFailed") };
  }
  return { sentTo: user.email, ttlMinutes: CODE_TTL_MINUTES };
}

export type IssueApiKeyInput = {
  name: string;
  scope: string;
  // Days, or null for no expiry.
  expiresInDays: number | null;
  // One of these, by the account's way of confirming.
  passkey?: AuthenticationResponseJSON;
  code?: string;
};

export async function issueApiKey(input: IssueApiKeyInput): Promise<{ key: string } | { error: string }> {
  const user = await requireUser("/account");
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

  if (!(await verifyReauth(user, "api-key", { passkey: input.passkey, code: input.code }))) {
    return { error: t("notConfirmed") };
  }

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
