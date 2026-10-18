import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { SIGNUP_TTL_HOURS, getSignupSettings } from "@/lib/auth/signup";
import styles from "@/styles/ui.module.css";
import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("signup.title") }) };
}

// Self-registration: asks for an email address and mails a registration link
// (lib/auth/signup.ts). Only when an admin has turned it on.
export default async function SignupPage() {
  await connection();
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const [settings, t] = await Promise.all([getSignupSettings(), getTranslations()]);

  return (
    <main className={styles.narrow} data-ui="SignupPage">
      <h1 className={styles.title}>{t("signup.title")}</h1>
      {settings.enabled ? (
        <>
          <p className={styles.lead}>{t("signup.lead")}</p>
          <SignupForm allowedDomains={settings.allowedDomains} ttlHours={SIGNUP_TTL_HOURS} />
        </>
      ) : (
        <p className={styles.lead} data-ui="SignupPage.closed">
          {t("login.inviteOnly")}
        </p>
      )}
      <p className={styles.note} style={{ marginTop: 24 }}>
        {t.rich("signup.alreadyHave", { link: (chunks) => <Link href="/login">{chunks}</Link> })}
      </p>
    </main>
  );
}
