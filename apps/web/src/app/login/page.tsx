import type { Metadata } from "next";
import { withBasePath } from "@/lib/base-path";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { getCurrentUser, getPasskeySetupUser, safeNextPath } from "@/lib/auth/session";
import { getSignupSettings } from "@/lib/auth/signup";
import { OIDC_START_PATH, type OidcErrorCode, getOidcSettings, isOidcErrorCode } from "@/lib/auth/oidc";
import styles from "@/styles/ui.module.css";
import { LoginForm } from "./login-form";
import { PasskeyLoginButton } from "./passkey-login-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("login.title") }) };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!(await isSetupComplete(prisma))) redirect("/setup");

  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getCurrentUser()) redirect(next);
  // Signed in, but the site requires a passkey this account doesn't have yet.
  if (await getPasskeySetupUser()) redirect(`/passkey-setup?next=${encodeURIComponent(next)}`);
  const [signup, oidc, t] = await Promise.all([getSignupSettings(), getOidcSettings(), getTranslations("login")]);
  // Only codes we know: the message itself never comes from the URL.
  const ssoError = isOidcErrorCode(params.sso_error) ? t(`ssoErrors.${params.sso_error as OidcErrorCode}`) : null;
  const ssoOnly = oidc.enabled && oidc.passwordLogin === "SITE_ADMINS_ONLY";
  const passwordReset = params.reset === "done";

  return (
    <main className={styles.narrow} data-ui="LoginPage">
      <h1 className={styles.title}>{t("heading")}</h1>
      {passwordReset && (
        <p className={styles.success} data-ui="LoginPage.passwordResetStatus" style={{ marginBottom: 16 }}>
          {t("passwordResetDone")}
        </p>
      )}
      {ssoError && (
        <p className={styles.error} data-ui="LoginPage.ssoError" style={{ marginBottom: 16 }}>
          {ssoError}
        </p>
      )}
      {oidc.enabled && (
        <a
          // A plain link (a Route Handler, not a page): the base path by hand.
          href={withBasePath(`${OIDC_START_PATH}?next=${encodeURIComponent(next)}`)}
          className={styles.button}
          style={{ display: "block", textAlign: "center", marginBottom: 24 }}
          data-ui="LoginPage.ssoButton"
        >
          {t("ssoButton", { provider: oidc.buttonLabel || t("ssoDefaultName") })}
        </a>
      )}
      {ssoOnly ? (
        // Kept for site admins only (a way in if the IdP is down).
        <details data-ui="LoginPage.adminPasswordLogin">
          <summary className={styles.note} style={{ cursor: "pointer" }}>
            {t("adminPasswordLogin")}
          </summary>
          <div style={{ marginTop: 12 }}>
            <PasskeyLoginButton next={next} />
            <LoginForm next={next} />
          </div>
        </details>
      ) : (
        <>
          {oidc.enabled && <p className={styles.note} style={{ marginBottom: 12 }}>{t("orPassword")}</p>}
          <PasskeyLoginButton next={next} />
          <LoginForm next={next} />
        </>
      )}
      {signup.enabled ? (
        <p className={styles.note} style={{ marginTop: 24 }}>
          {t.rich("signupPrompt", {
            link: (chunks) => (
              <Link href="/signup" data-ui="LoginPage.signupLink">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : (
        <p className={styles.note} style={{ marginTop: 24 }}>
          {t("inviteOnly")}
        </p>
      )}
    </main>
  );
}
