// Site colors configurable in /admin. Shared by the server (root layout,
// Server Action) and the admin form (browser) — keep dependency-free.
//
// Each token is a CSS custom property on :root. globals.css holds the same
// defaults (so pages render correctly even before the database is reachable)
// plus fixed tokens that aren't configurable yet. CSS should only ever use
// the variables, never literal colors. Each one's name and description are
// admin.theme.tokens.<key> / <key>Description.

export const THEME_TOKENS = [
  {
    key: "primary",
    cssVar: "--color-primary",
    defaultValue: "#173c3c",
  },
  {
    key: "primaryLight",
    cssVar: "--color-primary-light",
    defaultValue: "#e8f2f2",
  },
  {
    key: "background",
    cssVar: "--color-background",
    defaultValue: "#fafaf8",
  },
  {
    key: "muted",
    cssVar: "--color-muted",
    defaultValue: "#687280",
  },
] as const;

export type ThemeKey = (typeof THEME_TOKENS)[number]["key"];
export type ThemeColors = Record<ThemeKey, string>;

export const DEFAULT_THEME = Object.fromEntries(THEME_TOKENS.map((t) => [t.key, t.defaultValue])) as ThemeColors;

// Only #rrggbb is accepted: the values are written into a <style> element.
export function normalizeColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

// Stored JSON → complete theme; unknown keys and bad values fall back to defaults.
export function resolveTheme(stored: unknown): ThemeColors {
  const source = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const theme = { ...DEFAULT_THEME };
  for (const t of THEME_TOKENS) theme[t.key] = normalizeColor(source[t.key]) ?? t.defaultValue;
  return theme;
}

export function themeCss(theme: ThemeColors): string {
  return `:root{${THEME_TOKENS.map((t) => `${t.cssVar}:${theme[t.key]}`).join(";")}}`;
}

// WCAG contrast ratio of two #rrggbb colors (1–21).
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
