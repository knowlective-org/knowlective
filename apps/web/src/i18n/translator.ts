import { createTranslator } from "next-intl";
import type { AppLocale } from "./locales";
import { MESSAGES } from "./messages";

// A translator for a given language that doesn't depend on a request: for
// text that outlives one or isn't for its viewer (emails, the audit log).
// Screens use getTranslations() / useTranslations() instead.
export function translatorFor(locale: AppLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale] });
}
