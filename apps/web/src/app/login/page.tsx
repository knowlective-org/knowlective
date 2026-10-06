import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { getCurrentUser, safeNextPath } from "@/lib/auth/session";
import { getSignupSettings } from "@/lib/auth/signup";
import { OIDC_ERROR_MESSAGES, OIDC_START_PATH, getOidcSettings } from "@/lib/auth/oidc";
import styles from "@/styles/ui.module.css";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "ログイン | yosuga",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!(await isSetupComplete(prisma))) redirect("/setup");

  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getCurrentUser()) redirect(next);
  const [signup, oidc] = await Promise.all([getSignupSettings(), getOidcSettings()]);
  // Only codes we know: the message itself never comes from the URL.
  const ssoError = typeof params.sso_error === "string" && params.sso_error in OIDC_ERROR_MESSAGES
    ? OIDC_ERROR_MESSAGES[params.sso_error as keyof typeof OIDC_ERROR_MESSAGES]
    : null;
  const ssoOnly = oidc.enabled && oidc.passwordLogin === "SITE_ADMINS_ONLY";

  return (
    <main className={styles.narrow} data-ui="LoginPage">
      <h1 className={styles.title}>yosuga にログイン</h1>
      {ssoError && (
        <p className={styles.error} data-ui="LoginPage.ssoError" style={{ marginBottom: 16 }}>
          {ssoError}
        </p>
      )}
      {oidc.enabled && (
        <a
          href={`${OIDC_START_PATH}?next=${encodeURIComponent(next)}`}
          className={styles.button}
          style={{ display: "block", textAlign: "center", marginBottom: 24 }}
          data-ui="LoginPage.ssoButton"
        >
          {oidc.buttonLabel}でログイン
        </a>
      )}
      {ssoOnly ? (
        // Kept for site admins only (a way in if the IdP is down).
        <details data-ui="LoginPage.adminPasswordLogin">
          <summary className={styles.note} style={{ cursor: "pointer" }}>
            サイト管理者の方（パスワードでログイン）
          </summary>
          <div style={{ marginTop: 12 }}>
            <LoginForm next={next} />
          </div>
        </details>
      ) : (
        <>
          {oidc.enabled && <p className={styles.note} style={{ marginBottom: 12 }}>またはメールアドレスとパスワードでログイン</p>}
          <LoginForm next={next} />
        </>
      )}
      {signup.enabled ? (
        <p className={styles.note} style={{ marginTop: 24 }}>
          アカウントをお持ちでない場合は、
          <Link href="/signup" data-ui="LoginPage.signupLink">
            アカウント登録
          </Link>
          から登録できます。
        </p>
      ) : (
        <p className={styles.note} style={{ marginTop: 24 }}>
          アカウントは招待制です。管理者から届いた招待リンクから登録してください。
        </p>
      )}
    </main>
  );
}
