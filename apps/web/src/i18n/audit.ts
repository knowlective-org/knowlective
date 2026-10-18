import { siteDefaultLocale } from "./locale";
import { translatorFor } from "./translator";

// Text for audit log entries: written once, when the change is made, in the
// site's default language (the log is shared by every admin).
export async function auditTranslator() {
  return translatorFor(await siteDefaultLocale());
}
