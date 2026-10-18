"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "shared";
import {
  PasswordResetUnavailableError,
  completePasswordReset,
  findValidPasswordReset,
} from "@/lib/auth/password-reset";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import { recordAudit, userLabel } from "@/lib/audit";
import { auditTranslator } from "@/i18n/audit";

export type ResetPasswordState = { error?: string };

export async function resetPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const t = await getTranslations();
  const token = formData.get("token");
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof token !== "string" || typeof password !== "string" || typeof confirm !== "string") {
    return { error: t("common.errors.invalidInput") };
  }

  const reset = await findValidPasswordReset(token);
  if (!reset) return { error: t("resetPassword.errors.unavailable") };
  // SSO-only sites: a password would be useless (and an unused way in).
  if (!(await passwordLoginAllowed(reset.user.siteRole))) {
    return { error: t("common.errors.ssoOnly") };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: t("common.errors.passwordLength", { min: MIN_PASSWORD_LENGTH }) };
  }
  if (password !== confirm) return { error: t("common.errors.passwordMismatch") };

  try {
    await completePasswordReset(reset.id, reset.user.id, password);
  } catch (err) {
    if (err instanceof PasswordResetUnavailableError) return { error: t("resetPassword.errors.unavailable") };
    throw err;
  }
  const who = userLabel(reset.user);
  const audit = await auditTranslator();
  await recordAudit(
    { userId: reset.user.id, label: who },
    "user.password.reset",
    audit("audit.passwordReset", { who, via: reset.issuedByAdmin ? "admin" : "email" }),
    { userId: reset.user.id, issuedByAdmin: reset.issuedByAdmin },
  );
  // Log in with the new password rather than automatically: every session
  // was just ended, and the login page applies its own checks.
  redirect("/login?reset=done");
}
