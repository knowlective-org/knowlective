import type { AppLocale } from "../locales";
import en, { type Messages } from "./en";
import ja from "./ja";

// Every language's text. ja has en's keys (checked by its type); its values
// are typed as plain strings, so it's cast to en's type for the translator.
export const MESSAGES: Record<AppLocale, Messages> = { en, ja: ja as unknown as Messages };
