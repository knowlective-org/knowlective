import { getRequestConfig } from "next-intl/server";
import { requestLocale } from "./locale";
import { isLocale } from "./locales";
import { MESSAGES } from "./messages";

// next-intl's per-request configuration (wired up in next.config.ts). There
// is no locale in the URL: requestLocale() picks it. An explicit locale
// (getTranslations({ locale })) is used as given, e.g. for emails.
export default getRequestConfig(async ({ locale }) => {
  const resolved = isLocale(locale) ? locale : await requestLocale();
  return {
    locale: resolved,
    messages: MESSAGES[resolved],
    // Dates are shown in the server's time zone (TZ), as before.
    timeZone: process.env.TZ || "Asia/Tokyo",
  };
});
