import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getBuildInfo, versionLabel } from "@/lib/build-info";
import { getSourceUrl } from "@/lib/source";
import { getSystemInfo } from "@/lib/system-info";
import styles from "@/styles/ui.module.css";

// Which KNOWLECTIVE this is (version, commit, build time) and what it runs on
// (packages, runtime, database). Site admins only.
export default async function AdminAboutPage() {
  await requireAdmin(["SITE_ADMIN"]);
  const build = getBuildInfo();
  const [system, t, format] = await Promise.all([getSystemInfo(), getTranslations("admin.about"), getFormatter()]);
  const dateTime = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const sourceUrl = getSourceUrl();
  // A commit link only for the upstream repository on GitHub (a fork's URL may not take /commit/).
  const commitUrl =
    build.commit && sourceUrl.startsWith("https://github.com/") ? `${sourceUrl.replace(/\/+$/, "")}/commit/${build.commit}` : null;

  return (
    <>
      <section className={styles.section} data-ui="AdminAboutPage">
        <h2 className={styles.sectionTitle}>{t("knowlective")}</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th scope="row">{t("version")}</th>
                <td data-ui="AdminAboutPage.version">
                  <code>{versionLabel(build)}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">{t("commit")}</th>
                <td data-ui="AdminAboutPage.commit">
                  {build.commit ? (
                    commitUrl ? (
                      <a href={commitUrl} target="_blank" rel="noopener noreferrer" data-ui="AdminAboutPage.commitLink">
                        <code>{build.commit}</code>
                      </a>
                    ) : (
                      <code>{build.commit}</code>
                    )
                  ) : (
                    t("unknown")
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("built")}</th>
                <td data-ui="AdminAboutPage.built">{build.builtAt ? dateTime(new Date(build.builtAt)) : t("development")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("runtime")}</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th scope="row">Node.js</th>
                <td data-ui="AdminAboutPage.node">
                  <code>{system.node}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">PostgreSQL</th>
                <td data-ui="AdminAboutPage.postgres">{system.postgres ? <code>{system.postgres}</code> : t("unknown")}</td>
              </tr>
              <tr>
                <th scope="row">{t("migrations")}</th>
                <td data-ui="AdminAboutPage.migrations">
                  {system.migrations.latest ? (
                    <>
                      <code>{system.migrations.latest}</code>
                      <div className={styles.note}>
                        {t("migrationsNote", {
                          count: system.migrations.count,
                          date: system.migrations.latestAt ? dateTime(system.migrations.latestAt) : "—",
                        })}
                      </div>
                    </>
                  ) : (
                    t("unknown")
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("packages")}</h2>
        <p className={styles.note} style={{ marginBottom: 12 }}>
          {t("packagesLead", { count: system.packages.length })}
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("packageName")}</th>
                <th>{t("installed")}</th>
                <th>{t("wanted")}</th>
                <th>{t("license")}</th>
                <th>{t("usedBy")}</th>
              </tr>
            </thead>
            <tbody>
              {system.packages.map((p) => (
                <tr key={p.name} data-ui="AdminAboutPage.packageRow" data-id={p.name}>
                  <td>
                    <code>{p.name}</code>
                  </td>
                  <td>{p.version ? <code>{p.version}</code> : t("unknown")}</td>
                  <td>
                    <code>{p.wanted}</code>
                  </td>
                  <td>{p.license ?? "—"}</td>
                  <td>{p.usedBy.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
