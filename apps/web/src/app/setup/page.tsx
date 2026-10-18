import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { isSetupComplete, MIN_MASTER_PASSWORD_LENGTH } from "shared";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/request";
import { SetupForm } from "./setup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("setup.title") }) };
}

export default async function SetupPage() {
  await connection();
  if (await isSetupComplete(prisma)) {
    redirect("/");
  }
  const [t, locale] = await Promise.all([getTranslations("setup"), getLocale()]);

  return (
    <main style={{ maxWidth: 480, margin: "64px auto", padding: "0 16px" }} data-ui="SetupPage">
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>{t("heading")}</h1>
      <p style={{ lineHeight: 1.7, marginBottom: 12 }}>{t("lead")}</p>
      <p style={{ lineHeight: 1.7, marginBottom: 24 }}>{t("masterPasswordNote")}</p>
      <SetupForm minLength={MIN_MASTER_PASSWORD_LENGTH} suggestedUrl={await getRequestOrigin()} suggestedLocale={locale} />
    </main>
  );
}
