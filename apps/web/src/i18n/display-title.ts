import { getTranslations } from "next-intl/server";
import { displayTitle } from "@/lib/page-title";

// displayTitle() with the request's word for an empty title (server side;
// client components use useDisplayTitle()).
export async function getDisplayTitle(): Promise<(title: string) => string> {
  const t = await getTranslations("common");
  const untitled = t("untitled");
  return (title) => displayTitle(title, untitled);
}

// The same for text that isn't for the request's viewer (the audit log):
// `t` is a translatorFor() / auditTranslator() translator.
export function displayTitleWith(t: (key: "common.untitled") => string): (title: string) => string {
  const untitled = t("common.untitled");
  return (title) => displayTitle(title, untitled);
}
