import { getFormatter, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { countAuditLogs, listAuditLogs } from "@/lib/audit";
import { Pagination, pageParam } from "@/components/pagination";
import { openOptionalEmail } from "@/lib/emails";
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  LOCK_WINDOW_MS,
  MAX_FAILURES,
  listActiveAdminSessions,
  requireAdmin,
} from "@/lib/admin/auth";
import styles from "@/styles/ui.module.css";
import { revokeOtherSessions, revokeSession } from "../actions";
import { IpAllowlistForm } from "../ip-allowlist-form";
import { NetworkAccessForm } from "../network-access-form";
import { isIpAllowed } from "@/lib/ip";

// Audit log entries per page (?auditPage=N).
const AUDIT_PAGE_SIZE = 20;

export default async function AdminSecurityPage({ searchParams }: PageProps<"/admin/security">) {
  const { ctx, config, session } = await requireAdmin(["SITE_ADMIN"]);
  const auditCount = await countAuditLogs();
  const network = await prisma.instanceConfig.findUniqueOrThrow({
    where: { id: 1 },
    select: {
      networkFullAccess: true,
      networkOtherAccess: true,
      networkOtherRead: true,
      networkOtherWrite: true,
      networkOtherDownload: true,
      networkOtherUpload: true,
    },
  });
  const auditPages = Math.max(1, Math.ceil(auditCount / AUDIT_PAGE_SIZE));
  const auditPage = pageParam((await searchParams).auditPage, auditPages);
  const [sessions, attempts, auditLogs, t, format] = await Promise.all([
    listActiveAdminSessions(),
    prisma.adminLoginAttempt
      .findMany({ orderBy: { createdAt: "desc" }, take: 30 })
      .then((rows) => Promise.all(rows.map(async (a) => ({ ...a, email: await openOptionalEmail(a.emailEnc) })))),
    listAuditLogs(AUDIT_PAGE_SIZE, (auditPage - 1) * AUDIT_PAGE_SIZE),
    getTranslations("admin.security"),
    getFormatter(),
  ]);
  const dateFormat = { format: (d: Date) => format.dateTime(d, { dateStyle: "short", timeStyle: "medium" }) };
  const reason = (code: string | null) =>
    code === "bad_credentials" || code === "locked" || code === "bad_credentials_cleared" || code === "ip_denied"
      ? t(`reasons.${code}`)
      : t("failure");

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("loginProtection")}</h2>
        <ul className={styles.note} style={{ paddingLeft: 20 }}>
          <li>{t("needsCode")}</li>
          <li>{t("lockout", { minutes: LOCK_WINDOW_MS / 60000, failures: MAX_FAILURES })}</li>
          <li>{t("timeout", { idle: IDLE_TIMEOUT_MS / 60000, hours: ABSOLUTE_TIMEOUT_MS / 3600000 })}</li>
        </ul>
      </section>

      <section className={styles.section} id="audit" data-ui="AdminSecurityPage.auditSection">
        <h2 className={styles.sectionTitle}>{t("audit")}</h2>
        <p className={styles.note} style={{ marginBottom: 12 }}>
          {t("auditLead")}
        </p>
        {auditLogs.length === 0 ? (
          <p className={styles.note}>{t("noAudit")}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("time")}</th>
                  <th>{t("actor")}</th>
                  <th>{t("change")}</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr data-ui="AdminSecurityPage.auditLogRow" data-id={log.id} key={log.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{dateFormat.format(log.createdAt)}</td>
                    <td>{log.actorLabel}</td>
                    <td>{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {auditCount > 0 && (
          <p className={styles.note} style={{ marginTop: 8 }} data-ui="AdminSecurityPage.auditRange">
            {t("auditRange", {
              from: (auditPage - 1) * AUDIT_PAGE_SIZE + 1,
              to: Math.min(auditPage * AUDIT_PAGE_SIZE, auditCount),
              total: auditCount,
            })}
          </p>
        )}
        <Pagination
          page={auditPage}
          pageCount={auditPages}
          href={(n) => `/admin/security?auditPage=${n}#audit`}
          label={t("audit")}
        />
      </section>

      <section className={styles.section} data-ui="AdminSecurityPage.networkSection">
        <h2 className={styles.sectionTitle}>{t("network")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("networkLead")}
        </p>
        <NetworkAccessForm
          fullAccess={network.networkFullAccess}
          others={{
            access: network.networkOtherAccess,
            read: network.networkOtherRead,
            write: network.networkOtherWrite,
            download: network.networkOtherDownload,
            upload: network.networkOtherUpload,
          }}
          clientIp={ctx.ip}
          clientFull={isIpAllowed(ctx.ip, network.networkFullAccess)}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("ipAllowlist")}</h2>
        <IpAllowlistForm current={config.adminIpAllowlist} clientIp={ctx.ip} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("sessions")}</h2>
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.tableMiddle}`}>
            <thead>
              <tr>
                <th>{t("user")}</th>
                <th>{t("address")}</th>
                <th>{t("browser")}</th>
                <th>{t("loggedIn")}</th>
                <th>{t("lastActive")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr data-ui="AdminSecurityPage.sessionRow" key={s.tokenHash}>
                  <td>
                    {s.user ? (s.user.name ?? s.user.email) : t("masterPassword")}
                    {s.tokenHash === session.tokenHash && t("thisSession")}
                  </td>
                  <td>{s.ip}</td>
                  <td className={styles.ua} title={s.userAgent ?? ""}>
                    {s.userAgent ?? "-"}
                  </td>
                  <td>{dateFormat.format(s.createdAt)}</td>
                  <td>{dateFormat.format(s.lastSeenAt)}</td>
                  <td>
                    <form data-ui="AdminSecurityPage.revokeSessionForm" action={revokeSession}>
                      <input type="hidden" name="tokenHash" value={s.tokenHash} />
                      <button data-ui="AdminSecurityPage.revokeSessionButton" type="submit" className={styles.danger}>
                        {t("end")}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sessions.length > 1 && (
          <form data-ui="AdminSecurityPage.revokeOtherSessionsForm" action={revokeOtherSessions} style={{ marginTop: 12 }}>
            <button data-ui="AdminSecurityPage.revokeOtherSessionsButton" type="submit" className={styles.danger}>
              {t("endOthers")}
            </button>
          </form>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("attempts")}</h2>
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.tableMiddle}`}>
            <thead>
              <tr>
                <th>{t("time")}</th>
                <th>{t("email")}</th>
                <th>{t("address")}</th>
                <th>{t("result")}</th>
                <th>{t("browser")}</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr data-ui="AdminSecurityPage.loginAttemptRow" data-id={a.id} key={a.id}>
                  <td>{dateFormat.format(a.createdAt)}</td>
                  <td>{a.email ?? t("masterPassword")}</td>
                  <td>{a.ip}</td>
                  <td>{a.success ? t("success") : reason(a.reason)}</td>
                  <td className={styles.ua} title={a.userAgent ?? ""}>
                    {a.userAgent ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
