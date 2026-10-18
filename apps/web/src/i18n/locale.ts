import { headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { sessionUserLocale } from "@/lib/auth/session";
import { type AppLocale, FALLBACK_LOCALE, isLocale, negotiateLocale } from "./locales";

// Which language a request is shown in: the signed-in user's choice (account
// screen), else the browser's (Accept-Language), else the site default
// (/admin overview).

// The site default (InstanceConfig.defaultLocale). Also the language of
// emails to people without an account, and of the audit log.
export async function siteDefaultLocale(): Promise<AppLocale> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { defaultLocale: true } });
  return isLocale(config?.defaultLocale) ? config.defaultLocale : FALLBACK_LOCALE;
}

export const requestLocale = cache(async (): Promise<AppLocale> => {
  const chosen = await sessionUserLocale();
  if (isLocale(chosen)) return chosen;
  return negotiateLocale((await headers()).get("accept-language")) ?? (await siteDefaultLocale());
});

// The language to write to a user in (emails): their choice, else the site
// default (their browser isn't known outside a request of theirs).
export async function userLocale(userId: string): Promise<AppLocale> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
  return isLocale(user?.locale) ? user.locale : siteDefaultLocale();
}
