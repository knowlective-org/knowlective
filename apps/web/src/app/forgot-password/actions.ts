"use server";

import { getTranslations } from "next-intl/server";
import { userLocale } from "@/i18n/locale";
import { prisma } from "@/lib/db";
import { emailWhere } from "@/lib/emails";
import { normalizeEmail } from "@/lib/auth/session";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import {
  PASSWORD_RESET_TTL_MINUTES,
  createPasswordReset,
  isPasswordResetRateLimited,
} from "@/lib/auth/password-reset";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { passwordResetMail } from "@/lib/mail-templates";
import { getRequestContext } from "@/lib/request";
import { getPublicUrl } from "@/lib/site-url";

export type ForgotPasswordState = { error?: string; sentTo?: string };

// Mails a reset link if the address belongs to an enabled account that may
// sign in with a password. The answer is the same in every case (and the
// mail is sent in the background so timing doesn't differ either), so the
// form can't be used to find out who has an account.
// auth: public — asking for a reset link (same answer whatever the address).
export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const t = await getTranslations("common.errors");
  if (!(await isMailConfigured())) {
    return { error: t("mailNotConfigured") };
  }
  const raw = formData.get("email");
  if (typeof raw !== "string") return { error: t("invalidInput") };
  const email = normalizeEmail(raw);
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
    return { error: t("emailFormat") };
  }

  const { ip } = await getRequestContext();
  const user = await prisma.user.findUnique({
    where: await emailWhere(email),
    select: { id: true, disabledAt: true, siteRole: true },
  });
  if (
    user &&
    !user.disabledAt &&
    (await passwordLoginAllowed(user.siteRole)) &&
    !(await isPasswordResetRateLimited(user.id, ip))
  ) {
    const token = await createPasswordReset(user.id, { byAdmin: false, ip });
    const link = `${await getPublicUrl()}/reset-password/${token}`;
    // In the account's language. Not waited for (see above).
    void userLocale(user.id)
      .then((locale) =>
        sendMail({ to: email, ...passwordResetMail(locale, { link, ttlMinutes: PASSWORD_RESET_TTL_MINUTES, byAdmin: false }) }),
      )
      .catch((err) => console.error("[forgot-password] sending the mail failed", err));
  }
  return { sentTo: email };
}
