import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/admin/auth";
import { testResult } from "@/lib/auth/oidc-test";
import styles from "@/styles/ui.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("admin.oidcTest.title") }), robots: { index: false, follow: false } };
}

// Where the single sign-on test login (lib/auth/oidc-test.ts) ends: what a
// login as the tested user would get. Only for the admin who ran the test.
export default async function AdminOidcTestPage({ params }: PageProps<"/admin/oidc-test/[id]">) {
  const { session } = await requireAdmin(["SITE_ADMIN"]);
  const result = testResult((await params).id, session.userId);
  const t = await getTranslations("admin.oidcTest");
  const back = (
    <p className={styles.note} style={{ marginTop: 24 }}>
      <Link href="/admin/users" data-ui="AdminOidcTestPage.backLink" style={{ textDecoration: "underline" }}>
        {t("backLink")}
      </Link>
    </p>
  );

  if (!result) {
    return (
      <section className={styles.section} data-ui="AdminOidcTestPage">
        <h2 className={styles.sectionTitle}>{t("heading")}</h2>
        <p className={styles.error} data-ui="AdminOidcTestPage.notFound">
          {t("notFound")}
        </p>
        {back}
      </section>
    );
  }

  if (!result.ok) {
    return (
      <section className={styles.section} data-ui="AdminOidcTestPage">
        <h2 className={styles.sectionTitle}>{t("heading")}</h2>
        <div className={styles.error} data-ui="AdminOidcTestPage.error">
          <p>{t("failed")}</p>
          <p>{t(`reasons.${result.reason}`)}</p>
          {result.idpError && <p>{t("idpError", { code: result.idpError })}</p>}
        </div>
        {back}
      </section>
    );
  }

  const row = (label: string, value: React.ReactNode, dataUi: string, warn = false) => (
    <tr>
      <th scope="row" style={{ whiteSpace: "nowrap" }}>
        {label}
      </th>
      <td className={warn ? styles.error : undefined} data-ui={dataUi}>
        {value}
      </td>
    </tr>
  );

  const nameCell = (
    <>
      <div>{result.displayName ?? t("noDisplayName")}</div>
      <div className={styles.note}>
        {result.nameSetting ? t("setting", { setting: result.nameSetting }) : t("defaultSetting")}
      </div>
      {result.missingNameClaims.length > 0 && (
        <div className={styles.note} data-ui="AdminOidcTestPage.missingNameClaims">
          {t("missing", { claims: result.missingNameClaims.join(", ") })}
        </div>
      )}
    </>
  );

  const groupsWarn = result.groupsClaim !== "" && (result.groups === null || result.userInfo === false);
  const groupsCell = !result.groupsClaim
    ? t("groupsNotSet")
    : result.groups === null
      ? t("groupsMissing", { claim: result.groupsClaim })
      : result.groups.length === 0
        ? t("groupsEmpty", { claim: result.groupsClaim })
        : result.groups.join(", ");

  return (
    <section className={styles.section} data-ui="AdminOidcTestPage">
      <h2 className={styles.sectionTitle}>{t("heading")}</h2>
      <p className={styles.lead}>{t("lead")}</p>
      <p className={styles.note} data-ui="AdminOidcTestPage.user">
        {result.loginHint ? t("user", { user: result.loginHint }) : t("noUser")}
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {row(t("displayName"), nameCell, "AdminOidcTestPage.displayName", result.displayName === null)}
            {row(t("groups"), groupsCell, "AdminOidcTestPage.groups", groupsWarn)}
            {row(
              t("email"),
              result.email
                ? `${result.email} (${t("emailVerified", { verified: String(result.emailVerified) })})`
                : t("noEmail"),
              "AdminOidcTestPage.email",
              result.email === null,
            )}
            {row(
              t("userInfo"),
              result.userInfo === true ? t("userInfoRead") : result.userInfo === false ? t("userInfoFailed") : t("userInfoNone"),
              "AdminOidcTestPage.userInfo",
              result.userInfo === false,
            )}
            {row(t("subject"), <code>{result.subject}</code>, "AdminOidcTestPage.subject")}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 24 }}>{t("claims")}</h3>
      {result.claims.length === 0 ? (
        <p className={styles.note}>{t("noClaims")}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("claimName")}</th>
                <th>{t("claimValue")}</th>
                <th>{t("claimSource")}</th>
              </tr>
            </thead>
            <tbody>
              {result.claims.map((c) => (
                <tr key={c.name} data-ui="AdminOidcTestPage.claimRow" data-id={c.name}>
                  <td>
                    <code>{c.name}</code>
                  </td>
                  <td style={{ wordBreak: "break-all" }}>{c.value}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{t(`sources.${c.source}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {back}
    </section>
  );
}
