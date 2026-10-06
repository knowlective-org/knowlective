"use client";

import { useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { issueInvitation, type InvitationState } from "./actions";

const initialState: InvitationState = {};

export function InvitationForm({
  roots,
  ttlDays,
  mailConfigured,
  siteRoles,
}: {
  roots: { id: string; name: string }[];
  ttlDays: number;
  mailConfigured: boolean;
  // Roles the signed-in admin may hand out, with labels.
  siteRoles: { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(issueInvitation, initialState);
  const [target, setTarget] = useState(roots[0]?.id ?? "__new__");
  const [copied, setCopied] = useState(false);
  const [sendEmail, setSendEmail] = useState(mailConfigured);

  return (
    <div className={styles.form}>
      <form action={formAction} className={styles.form} onSubmit={() => setCopied(false)}>
        <label>
          ロール
          <select name="siteRole" defaultValue="USER" className={styles.field}>
            {siteRoles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          招待先
          <select
            name="root"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={styles.field}
          >
            {roots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            <option value="__new__">＋ 新しいナレッジルートを作る（招待した人がオーナー）</option>
          </select>
        </label>
        {target === "__new__" ? (
          <label>
            新しいナレッジルートの名前
            <input type="text" name="newRootName" required className={styles.field} />
          </label>
        ) : (
          <label>
            権限
            <select name="role" defaultValue="MEMBER" className={styles.field}>
              <option value="ADMIN">管理者</option>
              <option value="MEMBER">メンバー</option>
              <option value="GUEST">ゲスト（閲覧のみ）</option>
            </select>
          </label>
        )}
        <label>
          メールアドレス（{sendEmail ? "必須" : "任意"}。指定するとこのアドレスでしか登録できない）
          <input type="email" name="email" required={sendEmail} className={styles.field} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            name="sendEmail"
            checked={sendEmail}
            disabled={!mailConfigured}
            onChange={(e) => setSendEmail(e.target.checked)}
          />
          招待メールを送信する
        </label>
        {!mailConfigured && (
          <p className={styles.note}>
            メール送信が未設定のため、送信できません。「概要」の「メール送信」で設定すると使えます。
          </p>
        )}
        <p aria-live="polite" className={styles.error}>
          {state.error}
        </p>
        <button type="submit" disabled={pending} className={styles.button}>
          {pending ? "発行しています…" : sendEmail ? "招待リンクを発行してメールで送る" : "招待リンクを発行"}
        </button>
      </form>

      {state.link && (
        <div>
          {state.mailSentTo && (
            <p className={styles.success}>{state.mailSentTo} に招待メールを送信しました。</p>
          )}
          {state.mailError && (
            <p className={styles.error}>
              招待メールの送信に失敗しました（{state.mailError}）。招待リンクは有効なので、下のリンクを直接渡してください。
            </p>
          )}
          <p className={styles.note}>
            招待リンクは今だけ表示されます（{ttlDays}日間有効・1回限り）。相手に渡してください。
          </p>
          <p className={styles.secret}>{state.link}</p>
          <button
            type="button"
            className={styles.button}
            style={{ marginTop: 8 }}
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? "コピーしました" : "コピー"}
          </button>
        </div>
      )}
    </div>
  );
}
