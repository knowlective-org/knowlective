import { useTranslations } from "next-intl";
import { displayTitle } from "@/lib/page-title";

// displayTitle() with the viewer's word for an empty title (client side;
// server code uses getDisplayTitle()).
export function useDisplayTitle(): (title: string) => string {
  const untitled = useTranslations("common")("untitled");
  return (title) => displayTitle(title, untitled);
}
