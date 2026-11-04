import { en, ja } from "@blocknote/core/locales";
import { locales as multiColumn } from "@blocknote/xl-multi-column";
import type { AppLocale } from "./locales";

// BlockNote's own text (menus, placeholders, toolbars) in the viewer's
// language, the columns' (xl-multi-column) included. Our blocks' text is in
// i18n/messages like everything else.
export function blockNoteDictionary(locale: AppLocale) {
  return locale === "en" ? { ...en, multi_column: multiColumn.en } : { ...ja, multi_column: multiColumn.ja };
}
