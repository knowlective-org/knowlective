import { en, ja } from "@blocknote/core/locales";
import type { AppLocale } from "./locales";

// BlockNote's own text (menus, placeholders, toolbars) in the viewer's
// language. Our blocks' text is in i18n/messages like everything else.
export function blockNoteDictionary(locale: AppLocale) {
  return locale === "en" ? en : ja;
}
