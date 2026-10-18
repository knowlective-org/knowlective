import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/auth/password-reset";
import { isMailConfigured } from "@/lib/mail";
import styles from "@/styles/ui.module.css";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("forgotPassword.title") }) };
}

// Asks for an email address and mails a reset link (lib/auth/password-reset.ts).
export default async function ForgotPasswordPage() {
  await connection();
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const [mailConfigured, t] = await Promise.all([isMailConfigured(), getTranslations("forgotPassword")]);

  return (
    <main className={styles.narrow} data-ui="ForgotPasswordPage">
      <h1 className={styles.title}>{t("title")}</h1>
      {mailConfigured ? (
        <>
          <p className={styles.lead}>{t("lead")}</p>
          <ForgotPasswordForm ttlMinutes={PASSWORD_RESET_TTL_MINUTES} />
        </>
      ) : (
        <p className={styles.lead} data-ui="ForgotPasswordPage.mailNotConfigured">
          {t("mailNotConfigured")}
        </p>
      )}
      <p className={styles.note} style={{ marginTop: 24 }}>
        <Link href="/login" data-ui="ForgotPasswordPage.loginLink">{t("backToLogin")}</Link>
      </p>
    </main>
  );
}
