import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MIN_PASSWORD_LENGTH, isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { findValidPasswordReset } from "@/lib/auth/password-reset";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import styles from "@/styles/ui.module.css";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("resetPassword.title") }), robots: { index: false, follow: false } };
}

// Opened from a reset link (lib/auth/password-reset.ts). Works whether or not
// someone is logged in in this browser: the link alone decides the account.
export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  const { token } = await params;
  const reset = await findValidPasswordReset(token);
  const ssoOnly = reset !== null && !(await passwordLoginAllowed(reset.user.siteRole));
  const t = await getTranslations();

  if (!reset || ssoOnly) {
    return (
      <main className={styles.narrow} data-ui="ResetPasswordPage">
        <h1 className={styles.title}>{t("resetPassword.invalidTitle")}</h1>
        <p className={styles.lead} data-ui="ResetPasswordPage.invalid">
          {ssoOnly ? t("common.errors.ssoOnly") : t("resetPassword.invalid")}
        </p>
        <p className={styles.note}>
          {!ssoOnly && (
            <>
              <Link href="/forgot-password" data-ui="ResetPasswordPage.forgotPasswordLink">{t("resetPassword.retry")}</Link>
              {" / "}
            </>
          )}
          <Link href="/login" data-ui="ResetPasswordPage.loginLink">{t("resetPassword.toLogin")}</Link>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.narrow} data-ui="ResetPasswordPage">
      <h1 className={styles.title}>{t("resetPassword.title")}</h1>
      <p className={styles.lead}>{t("resetPassword.lead")}</p>
      <ResetPasswordForm token={token} email={reset.user.email} minLength={MIN_PASSWORD_LENGTH} />
    </main>
  );
}
