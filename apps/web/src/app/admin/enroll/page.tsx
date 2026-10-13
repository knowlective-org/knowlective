import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

export const metadata: Metadata = {
  title: "認証アプリの登録 | YOSUGA",
  robots: { index: false, follow: false },
};

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

  return (
    <main className={styles.narrow} data-ui="AdminEnrollPage">
      <h1 className={styles.title}>認証アプリの登録</h1>
      <p className={styles.lead}>
        管理画面へのログインには、{session.user ? "パスワード" : "マスターパスワード"}に加えて認証アプリのコードが必要です。
        Google Authenticator・Microsoft Authenticator・1Password などのアプリで、次の QR
        コードを読み取ってください。
      </p>
      <AuthenticatorQr secretBase32={secretBase32} defaultName={defaultName} initialQr={qr} />
      <p className={styles.note}>QR コードを読み取れない場合は、次のキーを手入力してください。</p>
      <p className={styles.secret} data-ui="AdminEnrollPage.secretKey">{base32}</p>
      <p className={styles.note} style={{ margin: "16px 0" }}>
        この画面は10分で無効になります。期限が切れたら、もう一度ログインしてください。
      </p>
      <EnrollForm />
    </main>
  );
}
