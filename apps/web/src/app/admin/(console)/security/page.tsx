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
import { REASON_LABELS, dateFormat } from "@/lib/admin/format";
import styles from "@/styles/ui.module.css";
import { revokeOtherSessions, revokeSession } from "../actions";
import { IpAllowlistForm } from "../ip-allowlist-form";

// Entries of 変更の記録 per page (?auditPage=N).
const AUDIT_PAGE_SIZE = 20;

export default async function AdminSecurityPage({ searchParams }: PageProps<"/admin/security">) {
  const { ctx, config, session } = await requireAdmin(["SITE_ADMIN"]);
  const auditCount = await countAuditLogs();
  const auditPages = Math.max(1, Math.ceil(auditCount / AUDIT_PAGE_SIZE));
  const auditPage = pageParam((await searchParams).auditPage, auditPages);
  const [sessions, attempts, auditLogs] = await Promise.all([
    listActiveAdminSessions(),
    prisma.adminLoginAttempt
      .findMany({ orderBy: { createdAt: "desc" }, take: 30 })
      .then((rows) => Promise.all(rows.map(async (a) => ({ ...a, email: await openOptionalEmail(a.emailEnc) })))),
    listAuditLogs(AUDIT_PAGE_SIZE, (auditPage - 1) * AUDIT_PAGE_SIZE),
  ]);

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ログインの保護</h2>
        <ul className={styles.note} style={{ paddingLeft: 20 }}>
          <li>ログインには、パスワードに加えて認証アプリのコードが必要です。</li>
          <li>
            同じ接続元から{LOCK_WINDOW_MS / 60000}分以内に{MAX_FAILURES}
            回失敗すると、その接続元を一時的にロックします。
          </li>
          <li>
            セッションは、操作がないまま{IDLE_TIMEOUT_MS / 60000}分経つか、ログインから
            {ABSOLUTE_TIMEOUT_MS / 3600000}時間経つと切れます。
          </li>
        </ul>
      </section>

      <section className={styles.section} id="audit" data-ui="AdminSecurityPage.auditSection">
        <h2 className={styles.sectionTitle}>変更の記録</h2>
        <p className={styles.note} style={{ marginBottom: 12 }}>
          ロール・アカウントの有効/無効・グループのメンバー・ページの権限・ナレッジルートの作成・招待の変更を記録しています。
        </p>
        {auditLogs.length === 0 ? (
          <p className={styles.note}>まだ記録はありません。</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>操作した人</th>
                  <th>内容</th>
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
            新しい順に {(auditPage - 1) * AUDIT_PAGE_SIZE + 1}〜{Math.min(auditPage * AUDIT_PAGE_SIZE, auditCount)} 件目（全 {auditCount} 件）
          </p>
        )}
        <Pagination
          page={auditPage}
          pageCount={auditPages}
          href={(n) => `/admin/security?auditPage=${n}#audit`}
          label="変更の記録"
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>管理画面の IP 制限</h2>
        <IpAllowlistForm current={config.adminIpAllowlist} clientIp={ctx.ip} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ログイン中のセッション</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ユーザー</th>
                <th>接続元</th>
                <th>ブラウザ</th>
                <th>ログイン</th>
                <th>最終操作</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr data-ui="AdminSecurityPage.sessionRow" key={s.tokenHash}>
                  <td>
                    {s.user ? (s.user.name ?? s.user.email) : "マスターパスワード"}
                    {s.tokenHash === session.tokenHash && "（このセッション）"}
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
                        終了
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
              このセッション以外をすべて終了
            </button>
          </form>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>最近のログイン試行</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>日時</th>
                <th>メールアドレス</th>
                <th>接続元</th>
                <th>結果</th>
                <th>ブラウザ</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr data-ui="AdminSecurityPage.loginAttemptRow" data-id={a.id} key={a.id}>
                  <td>{dateFormat.format(a.createdAt)}</td>
                  <td>{a.email ?? "（マスターパスワード）"}</td>
                  <td>{a.ip}</td>
                  <td>{a.success ? "成功" : (REASON_LABELS[a.reason ?? ""] ?? "失敗")}</td>
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
