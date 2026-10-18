"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { userLocale } from "@/i18n/locale";
import { isLocale } from "@/i18n/locales";
import { prisma } from "@/lib/db";
import { ownPasswordResetAvailability } from "@/lib/auth/own-password-reset";
import {
  PASSWORD_RESET_TTL_MINUTES,
  createPasswordReset,
  isPasswordResetRateLimited,
} from "@/lib/auth/password-reset";
import { requireUser } from "@/lib/auth/session";
import { sendMail } from "@/lib/mail";
import { passwordResetMail } from "@/lib/mail-templates";
import { getRequestContext } from "@/lib/request";
import { getPublicUrl } from "@/lib/site-url";

export type OwnPasswordResetState = { error?: string; sentTo?: string };

// Mails the signed-in user a link to set a new password (the same link and
// screen as "forgot password"). Their password isn't asked for or changed
// here: the mailbox is the proof, as it is when signed out.
export async function requestOwnPasswordReset(): Promise<OwnPasswordResetState> {
  const user = await requireUser("/account");
  const t = await getTranslations();
  const availability = await ownPasswordResetAvailability(user.id);
  if (!availability.available) {
    return {
      error: availability.reason === "mail" ? t("common.errors.mailNotConfigured") : t("account.errors.ssoAccount"),
    };
  }
  const { ip } = await getRequestContext();
  if (await isPasswordResetRateLimited(user.id, ip)) {
    return { error: t("account.errors.tooMany") };
  }
  const token = await createPasswordReset(user.id, { byAdmin: false, ip });
  const link = `${await getPublicUrl()}/reset-password/${token}`;
  try {
    // Waited for, unlike "forgot password": the person is known, so there is
    // nothing to hide, and they should hear if the mail couldn't be sent.
    await sendMail({
      to: user.email,
      ...passwordResetMail(await userLocale(user.id), { link, ttlMinutes: PASSWORD_RESET_TTL_MINUTES, byAdmin: false }),
    });
  } catch (err) {
    console.error("[account] sending the password reset mail failed", err);
    return { error: t("account.errors.mailFailed") };
  }
  return { sentTo: user.email };
}

export type LocaleState = { error?: string; saved?: boolean };

// The user's own display language ("" = the browser's). Shown from the next
// render on: the whole app is re-rendered in it.
export async function saveLocale(_prev: LocaleState, formData: FormData): Promise<LocaleState> {
  const user = await requireUser("/account");
  const raw = formData.get("locale");
  if (raw !== "" && !isLocale(raw)) return { error: (await getTranslations())("common.errors.invalidInput") };
  await prisma.user.update({ where: { id: user.id }, data: { locale: raw === "" ? null : raw } });
  revalidatePath("/", "layout");
  return { saved: true };
}
