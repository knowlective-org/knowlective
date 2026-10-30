"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { userLocale } from "@/i18n/locale";
import { prisma } from "@/lib/db";
import { emailWhere } from "@/lib/emails";
import { normalizeEmail } from "@/lib/auth/session";
import {
  SIGNUP_TTL_HOURS,
  createSignupInvitation,
  getSignupSettings,
  isDomainAllowed,
  isSignupRateLimited,
} from "@/lib/auth/signup";
import { sendMail } from "@/lib/mail";
import { alreadyRegisteredMail, signupMail } from "@/lib/mail-templates";
import { getRequestContext } from "@/lib/request";
import { getPublicUrl } from "@/lib/site-url";

export type SignupState = { error?: string; sentTo?: string };

// Mails a registration link (or, for a registered address, a note to log
// in). The answer is the same either way, so the form can't be used to find
// out who has an account.
// auth: public — self-registration (checked against the site's settings inside).
export async function requestSignup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const settings = await getSignupSettings();
  const t = await getTranslations();
  if (!settings.enabled) return { error: t("common.errors.signupClosed") };
  const raw = formData.get("email");
  if (typeof raw !== "string") return { error: t("common.errors.invalidInput") };
  const email = normalizeEmail(raw);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { error: t("common.errors.emailFormat") };
  }
  if (!isDomainAllowed(email, settings.allowedDomains)) {
    return {
      error: t("common.errors.domainNotAllowed", { domains: settings.allowedDomains.join(t("common.listSeparator")) }),
    };
  }
  const { ip } = await getRequestContext();
  if (await isSignupRateLimited(ip, email)) {
    return { error: t("signup.errors.tooMany") };
  }

  const base = await getPublicUrl();
  const existing = await prisma.user.findUnique({ where: await emailWhere(email), select: { id: true } });
  // Counted for rate limiting either way (a link for an existing account is never usable).
  const token = await createSignupInvitation(email, ip, settings.siteRole);
  try {
    await sendMail({
      to: email,
      ...(existing
        ? // In the account's language.
          alreadyRegisteredMail(await userLocale(existing.id), { loginLink: `${base}/login` })
        : // In the language of the page they signed up from.
          signupMail(await getLocale(), { link: `${base}/invite/${token}`, ttlHours: SIGNUP_TTL_HOURS })),
    });
  } catch (err) {
    console.error("[signup] sending the mail failed", err);
    return { error: t("common.errors.mailFailed") };
  }
  return { sentTo: email };
}
