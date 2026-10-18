// The display languages. No dependencies: read by the browser, the server
// and next.config.ts alike.

export const LOCALES = ["ja", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

// When nothing else decides (no site settings yet, e.g. during /setup).
export const FALLBACK_LOCALE: AppLocale = "ja";

// Each language's name in itself, for language pickers.
export const LOCALE_NAMES: Record<AppLocale, string> = {
  ja: "日本語",
  en: "English",
};

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// The first supported language an Accept-Language header asks for, by its
// q-values ("en-US,en;q=0.9,ja;q=0.8" → "en"). null: none of them.
export function negotiateLocale(acceptLanguage: string | null | undefined): AppLocale | null {
  if (!acceptLanguage) return null;
  const ranges = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { lang: tag.split("-")[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((r) => r.lang && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranges.map((r) => r.lang).find(isLocale) ?? null;
}
