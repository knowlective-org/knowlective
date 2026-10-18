import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { assertIpAllowed, getAdminConfig, getAdminSession } from "@/lib/admin/auth";
import { getRequestContext } from "@/lib/request";
import styles from "@/styles/ui.module.css";
import { cancelAccountLogin } from "../actions";
import { VerifyCodeForm } from "../login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("admin.login.verifyTitle") }), robots: { index: false, follow: false } };
}

// Second step of the account sign-in: the password is verified, the
// authenticator code is not yet.
export default async function AdminLoginVerifyPage() {
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  assertIpAllowed(ctx.ip, config.adminIpAllowlist);

  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (session.stage === "ACTIVE") redirect("/admin");
  if (session.stage === "ENROLL_TOTP") redirect("/admin/enroll");
  if (!session.user) redirect("/admin/login");
  const t = await getTranslations("admin.login");

  return (
    <main className={styles.narrow} data-ui="AdminLoginVerifyPage">
      <h1 className={styles.title}>{t("verifyHeading")}</h1>
      <p className={styles.lead}>
        {t("verifyLead", { email: session.user.email })}
      </p>
      <VerifyCodeForm />
      <p className={styles.note} style={{ margin: "16px 0" }}>
        {t("expiresNote")}
      </p>
      <form action={cancelAccountLogin} data-ui="AdminLoginVerifyPage.cancelForm">
        <button
          type="submit"
          className={styles.note}
          style={{ textDecoration: "underline", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          data-ui="AdminLoginVerifyPage.cancelButton"
        >
          {t("otherAccount")}
        </button>
      </form>
    </main>
  );
}
