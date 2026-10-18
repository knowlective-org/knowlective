import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { assertIpAllowed, getAdminConfig, getAdminSession } from "@/lib/admin/auth";
import { getRequestContext } from "@/lib/request";
import styles from "@/styles/ui.module.css";
import { AccountLoginForm, MasterLoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("admin.login.title") }), robots: { index: false, follow: false } };
}

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  assertIpAllowed(ctx.ip, config.adminIpAllowlist);

  const session = await getAdminSession();
  if (session?.stage === "ACTIVE") redirect("/admin");
  if (session?.stage === "ENROLL_TOTP") redirect("/admin/enroll");
  if (session?.stage === "VERIFY_TOTP") redirect("/admin/login/verify");

  const master = (await searchParams).mode === "master";
  const t = await getTranslations("admin.login");
  if (master) {
    const enrolled = config.totpSecret !== null;
    return (
      <main className={styles.narrow} data-ui="AdminLoginPage">
        <h1 className={styles.title}>{t("masterTitle")}</h1>
        <p className={styles.lead}>
          {t("masterLead")}
          {!enrolled && t("masterFirstTime")}
        </p>
        <MasterLoginForm needsCode={enrolled} />
        <p className={styles.note} style={{ marginTop: 24 }}>
          <Link href="/admin/login" data-ui="AdminLoginPage.accountLoginLink" style={{ textDecoration: "underline" }}>
            {t("withAccount")}
          </Link>
        </p>
        <p className={styles.note} style={{ marginTop: 8 }}>
          <Link href="/" data-ui="AdminLoginPage.appLink" style={{ textDecoration: "underline" }}>
            {t("backToApp")}
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.narrow} data-ui="AdminLoginPage">
      <h1 className={styles.title}>{t("heading")}</h1>
      <p className={styles.lead}>
        {t("lead")} {t("lead2")}
      </p>
      <AccountLoginForm />
      <p className={styles.note} style={{ marginTop: 24 }}>
        <Link href="/admin/login?mode=master" data-ui="AdminLoginPage.masterLoginLink" style={{ textDecoration: "underline" }}>
          {t("withMaster")}
        </Link>
      </p>
      <p className={styles.note} style={{ marginTop: 8 }}>
        <Link href="/" data-ui="AdminLoginPage.appLink" style={{ textDecoration: "underline" }}>
          {t("backToApp")}
        </Link>
      </p>
    </main>
  );
}
