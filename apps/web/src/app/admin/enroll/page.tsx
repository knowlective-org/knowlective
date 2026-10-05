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
import { otpauthUri, toBase32 } from "@/lib/admin/totp";
import styles from "@/styles/ui.module.css";
import { EnrollForm } from "./enroll-form";

export const metadata: Metadata = {
  title: "認証アプリの登録 | yosuga",
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
  const account = session.user?.email ?? "admin";
  const qr = await QRCode.toDataURL(otpauthUri(secret, account), { margin: 0, width: 184 });
  const base32 = toBase32(secret).replace(/(.{4})/g, "$1 ").trim();
  secret.fill(0);

  return (
    <main className={styles.narrow}>
      <h1 className={styles.title}>認証アプリの登録</h1>
      <p className={styles.lead}>
        管理画面へのログインには、{session.user ? "パスワード" : "マスターパスワード"}に加えて認証アプリのコードが必要です。
        Google Authenticator・Microsoft Authenticator・1Password などのアプリで、次の QR
        コードを読み取ってください。
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
      <img src={qr} alt="認証アプリ登録用の QR コード" className={styles.qr} />
      <p className={styles.note}>QR コードを読み取れない場合は、次のキーを手入力してください。</p>
      <p className={styles.secret}>{base32}</p>
      <p className={styles.note} style={{ margin: "16px 0" }}>
        この画面は10分で無効になります。期限が切れたら、もう一度ログインしてください。
      </p>
      <EnrollForm />
    </main>
  );
}
