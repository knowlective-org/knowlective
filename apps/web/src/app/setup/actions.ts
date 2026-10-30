"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  InstanceAlreadySetUpError,
  InvalidPublicUrlError,
  MIN_MASTER_PASSWORD_LENGTH,
  normalizePublicUrl,
  setupInstance,
} from "shared";
import { isLocale } from "@/i18n/locales";
import { prisma } from "@/lib/db";

export type SetupState = { error?: string };

// auth: public — first-time setup; refused once set up (setupInstance).
export async function completeSetup(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const t = await getTranslations();
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  const publicUrl = formData.get("publicUrl");
  const defaultLocale = formData.get("defaultLocale");

  if (typeof password !== "string" || typeof confirm !== "string" || typeof publicUrl !== "string" || !isLocale(defaultLocale)) {
    return { error: t("common.errors.invalidInput") };
  }
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    return { error: t("setup.errors.masterPasswordLength", { min: MIN_MASTER_PASSWORD_LENGTH }) };
  }
  if (password !== confirm) {
    return { error: t("common.errors.passwordMismatch") };
  }
  try {
    normalizePublicUrl(publicUrl);
  } catch (err) {
    if (err instanceof InvalidPublicUrlError) return { error: t(`publicUrl.${err.reason}`) };
    throw err;
  }

  try {
    await setupInstance(prisma, password, publicUrl, defaultLocale);
  } catch (err) {
    // Someone else finished setup first. Never overwrite an existing key.
    if (err instanceof InstanceAlreadySetUpError) redirect("/");
    console.error("[setup] failed", err);
    return { error: t("setup.errors.failed") };
  }

  // Continue straight to the first admin login, which enrolls 2FA.
  redirect("/admin/login");
}
