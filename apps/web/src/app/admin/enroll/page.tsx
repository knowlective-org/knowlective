import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import {
  assertIpAllowed,
  decryptTotpSecret,
  getAdminConfig,
  getAdminSession,
} from "@/lib/admin/auth";
import { getRequestContext } from "@/lib/request";
import { otpauthUri } from "@/lib/admin/otpauth";
import { randomAuthenticatorName, toBase32 } from "@/lib/admin/totp";
import styles from "@/styles/ui.module.css";
import { AuthenticatorQr } from "./authenticator-qr";
import { EnrollForm } from "./enroll-form";
import { QR_OPTIONS } from "./qr-options";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("admin.enroll.title") }), robots: { index: false, follow: false } };
}

export default async function AdminEnrollPage() {
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  assertIpAllowed(ctx.ip, config.adminIpAllowlist);

  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (session.stage === "ACTIVE") redirect("/admin");
  if (!session.pendingTotp) redirect("/admin/login");

  const secret = await decryptTotpSecret(session.pendingTotp, session.userId);
  const secretBase32 = toBase32(secret);
  secret.fill(0);
  // Name of the entry in the authenticator app, which can be changed on this
  // screen and is never stored. An account starts with its email address; the
  // master password has no account, so it starts with a random name.
  const defaultName = session.user?.email ?? randomAuthenticatorName();
  const qr = await QRCode.toDataURL(otpauthUri(secretBase32, defaultName), QR_OPTIONS);
  const base32 = secretBase32.replace(/(.{4})/g, "$1 ").trim();
  const t = await getTranslations("admin.enroll");

  return (
    <main className={styles.narrow} data-ui="AdminEnrollPage">
      <h1 className={styles.title}>{t("title")}</h1>
      <p className={styles.lead}>
        {t("lead", { secret: session.user ? "password" : "master" })} {t("lead2")}
      </p>
      <AuthenticatorQr secretBase32={secretBase32} defaultName={defaultName} initialQr={qr} />
      <p className={styles.note}>{t("manualKey")}</p>
      <p className={styles.secret} data-ui="AdminEnrollPage.secretKey">{base32}</p>
      <p className={styles.note} style={{ margin: "16px 0" }}>
        {t("expiresNote")}
      </p>
      <EnrollForm />
    </main>
  );
}
