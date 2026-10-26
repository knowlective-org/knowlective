"use server";

import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { recordAudit, userLabel } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { CODE_TTL_MINUTES, sendEmailCode } from "@/lib/auth/email-code";
import { EMAIL_CHANGE_TTL_MINUTES, changeEmailWithoutConfirmation, startEmailChange } from "@/lib/auth/email-change";
import { beginReauthentication } from "@/lib/auth/passkeys";
import { MAX_NAME_LENGTH, profileRules } from "@/lib/auth/profile";
import { reauthMethod, verifyReauth } from "@/lib/auth/reauth";
import { normalizeEmail, requireUser } from "@/lib/auth/session";

// The signed-in user's name and email address (account screen).

export type NameState = { error?: string; saved?: boolean };

export async function saveName(_prev: NameState, formData: FormData): Promise<NameState> {
  const user = await requireUser("/account");
  const t = await getTranslations("account.profile.errors");
  if ((await profileRules(user.id)).name !== "allowed") return { error: t("nameSso") };
  const raw = formData.get("name");
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: t("nameRequired") };
  if (name.length > MAX_NAME_LENGTH) return { error: t("nameTooLong", { max: MAX_NAME_LENGTH }) };
  if (name !== user.name) {
    await prisma.user.update({ where: { id: user.id }, data: { name } });
    const audit = await auditTranslator();
    await recordAudit(
      { userId: user.id, label: userLabel({ name, email: user.email }) },
      "user.name.change",
      audit("audit.nameChange", { from: user.name ?? "", to: name }),
      { userId: user.id },
    );
  }
  // The name shows in the sidebar, page info, child page tables…
  revalidatePath("/", "layout");
  return { saved: true };
}

// ---- Email address -----------------------------------------------------------
// Confirming it's them first (their passkey, else a code to the current
// address: lib/auth/reauth.ts), then a link to the new address.

export async function beginEmailChangePasskeyCheck(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const user = await requireUser("/account");
  return beginReauthentication(user);
}

export async function sendEmailChangeCode(): Promise<{ sentTo: string; ttlMinutes: number } | { error: string }> {
  const user = await requireUser("/account");
  const t = await getTranslations("account.profile.errors");
  if ((await profileRules(user.id)).email !== "allowed") return { error: t("mail") };
  if ((await reauthMethod(user.id)) !== "code") return { error: t("invalid") };
  try {
    if ((await sendEmailCode(user, "email-change")) === "tooMany") return { error: t("tooMany") };
  } catch (err) {
    console.error("[account] sending the confirmation code failed", err);
    return { error: t("mailFailed") };
  }
  return { sentTo: user.email, ttlMinutes: CODE_TTL_MINUTES };
}

export type EmailChangeInput = { newEmail: string; passkey?: AuthenticationResponseJSON; code?: string };

export async function requestEmailChange(
  input: EmailChangeInput,
): Promise<{ sentTo: string; ttlMinutes: number } | { error: string }> {
  const user = await requireUser("/account");
  const t = await getTranslations("account.profile.errors");
  if ((await profileRules(user.id)).email !== "allowed") return { error: t("mail") };
  const newEmail = typeof input?.newEmail === "string" ? input.newEmail.trim() : "";
  if (!(await verifyReauth(user, "email-change", { passkey: input.passkey, code: input.code }))) {
    return { error: t("notConfirmed") };
  }
  let result;
  try {
    result = await startEmailChange(user, newEmail);
  } catch (err) {
    console.error("[account] sending the email change link failed", err);
    return { error: t("mailFailed") };
  }
  if (result === "invalid") return { error: t("emailInvalid") };
  if (result === "same") return { error: t("emailSame") };
  if (result === "tooMany") return { error: t("tooMany") };
  return { sentTo: newEmail, ttlMinutes: EMAIL_CHANGE_TTL_MINUTES };
}

// Without confirmation: single sign-on accounts, when the admin console
// allows it (profileRules() "direct").
export async function changeEmailNow(newEmail: string): Promise<{ email: string } | { error: string }> {
  const user = await requireUser("/account");
  const t = await getTranslations("account.profile.errors");
  if ((await profileRules(user.id)).email !== "direct") return { error: t("invalid") };
  const result = await changeEmailWithoutConfirmation(user, typeof newEmail === "string" ? newEmail : "");
  if (result === "invalid") return { error: t("emailInvalid") };
  if (result === "same") return { error: t("emailSame") };
  if (result === "taken") return { error: t("emailTaken") };
  revalidatePath("/", "layout");
  return { email: normalizeEmail(newEmail) };
}
