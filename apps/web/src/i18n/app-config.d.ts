import type { AppLocale } from "./locales";
import type { Messages } from "./messages/en/index";

// Types next-intl's t() and locales: keys and parameters are checked against
// messages/en.ts.
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}
