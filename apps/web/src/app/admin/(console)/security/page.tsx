import { prisma } from "@/lib/db";
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

export default async function AdminSecurityPage() {
  const { ctx, config, session } = await requireAdmin(["SITE_ADMIN"]);
  const [sessions, attempts] = await Promise.all([
    listActiveAdminSessions(),
    prisma.adminLoginAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
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
                <tr key={s.tokenHash}>
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
                    <form action={revokeSession}>
                      <input type="hidden" name="tokenHash" value={s.tokenHash} />
                      <button type="submit" className={styles.danger}>
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
          <form action={revokeOtherSessions} style={{ marginTop: 12 }}>
            <button type="submit" className={styles.danger}>
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
                <tr key={a.id}>
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
