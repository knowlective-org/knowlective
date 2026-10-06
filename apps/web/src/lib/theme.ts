import { prisma } from "@/lib/db";
import { DEFAULT_THEME, resolveTheme, type ThemeColors } from "@/lib/theme-tokens";

// The site's colors (ThemeSettings, one row). Read on every request by the
// root layout; falls back to the defaults if the row or the database is
// missing, so login and setup still render.
export async function getTheme(): Promise<ThemeColors> {
  try {
    const row = await prisma.themeSettings.findUnique({ where: { id: 1 }, select: { colors: true } });
    return resolveTheme(row?.colors);
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export async function saveTheme(theme: ThemeColors): Promise<void> {
  await prisma.themeSettings.upsert({
    where: { id: 1 },
    create: { id: 1, colors: theme },
    update: { colors: theme },
  });
}
