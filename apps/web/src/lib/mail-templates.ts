import type { SiteRole } from "shared";
import { formatDuration } from "@/i18n/duration";
import type { AppLocale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translator";

// Plain-text email bodies sent by the app, in the recipient's language
// (i18n/locale.ts: userLocale() for an account, siteDefaultLocale() for an
// address without one). Links must be built from getPublicUrl(), never from
// request headers. Callers pass values only; the text is in i18n/messages.

type Mail = { subject: string; text: string };

function duration(locale: AppLocale, minutes: number): string {
  const t = translatorFor(locale);
  return formatDuration((unit, values) => t(`duration.${unit}`, values), minutes);
}

export function invitationMail(
  locale: AppLocale,
  input: {
    link: string;
    // null: invited by an admin signed in with the master password.
    inviterName: string | null;
    siteRole: SiteRole;
    groupNames: string[];
    ttlDays: number;
  },
): Mail {
  const t = translatorFor(locale);
  return {
    subject: t("mail.invitation.subject"),
    text: [
      t("mail.invitation.invitedBy", {
        inviter: input.inviterName ?? t("mail.invitation.administrator"),
        role: t(`mail.invitation.role.${input.siteRole}`),
      }),
      ...(input.groupNames.length > 0
        ? [t("mail.invitation.groups", { groups: input.groupNames.join(t("common.listSeparator")) })]
        : []),
      "",
      t("mail.invitation.open"),
      input.link,
      "",
      t("mail.invitation.expires", { duration: duration(locale, input.ttlDays * 24 * 60) }),
      t("mail.invitation.ignore"),
    ].join("\n"),
  };
}

// /signup: confirms the address and opens the registration page.
export function signupMail(locale: AppLocale, input: { link: string; ttlHours: number }): Mail {
  const t = translatorFor(locale);
  return {
    subject: t("mail.signup.subject"),
    text: [
      t("mail.signup.received"),
      "",
      t("mail.signup.open"),
      input.link,
      "",
      t("mail.signup.expires", { duration: duration(locale, input.ttlHours * 60) }),
      t("mail.signup.ignore"),
    ].join("\n"),
  };
}

// /signup for an address that already has an account. Sent instead of a
// registration link, so the form itself never reveals who is registered.
export function alreadyRegisteredMail(locale: AppLocale, input: { loginLink: string }): Mail {
  const t = translatorFor(locale);
  return {
    subject: t("mail.alreadyRegistered.subject"),
    text: [
      t("mail.alreadyRegistered.exists"),
      "",
      t("mail.alreadyRegistered.login"),
      input.loginLink,
      "",
      t("mail.alreadyRegistered.forgot", { forgotLink: t("login.forgotPasswordLink") }),
      t("mail.alreadyRegistered.ignore"),
    ].join("\n"),
  };
}

// /forgot-password, or a link a site admin chose to mail from /admin/users.
export function passwordResetMail(
  locale: AppLocale,
  input: { link: string; ttlMinutes: number; byAdmin: boolean },
): Mail {
  const t = translatorFor(locale);
  return {
    subject: t("mail.passwordReset.subject"),
    text: [
      input.byAdmin ? t("mail.passwordReset.issuedByAdmin") : t("mail.passwordReset.requested"),
      "",
      t("mail.passwordReset.open"),
      input.link,
      "",
      t("mail.passwordReset.expires", { duration: duration(locale, input.ttlMinutes) }),
      t("mail.passwordReset.ignore"),
    ].join("\n"),
  };
}

// A one-time code confirming it's the user (issuing an API key), in their language.
export function emailCodeMail(locale: AppLocale, input: { code: string; ttlMinutes: number }): Mail {
  const t = translatorFor(locale);
  return {
    subject: t("mail.emailCode.subject", { code: input.code }),
    text: [
      t("mail.emailCode.intro"),
      "",
      input.code,
      "",
      t("mail.emailCode.expires", { duration: duration(locale, input.ttlMinutes) }),
      t("mail.emailCode.ignore"),
    ].join("\n"),
  };
}

// The admin console's test email (overview → mail settings), in the
// sending admin's language.
export function testMail(locale: AppLocale): Mail {
  const t = translatorFor(locale);
  return { subject: t("mail.test.subject"), text: [t("mail.test.body"), t("mail.test.works")].join("\n") };
}
