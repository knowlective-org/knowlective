"use client";

import { useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { issueInvitation, type InvitationState } from "./actions";

const initialState: InvitationState = {};

export function InvitationForm({
  workspaces,
  ttlDays,
}: {
  workspaces: { id: string; name: string }[];
  ttlDays: number;
}) {
  const [state, formAction, pending] = useActionState(issueInvitation, initialState);
  const [target, setTarget] = useState(workspaces[0]?.id ?? "__new__");
  const [copied, setCopied] = useState(false);

  return (
    <div className={styles.form}>
      <form action={formAction} className={styles.form} onSubmit={() => setCopied(false)}>
        <label>
          招待先
          <select
            name="workspace"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={styles.field}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            <option value="__new__">＋ 新しいワークスペースを作る（招待した人がオーナー）</option>
          </select>
        </label>
        {target === "__new__" ? (
          <label>
            新しいワークスペースの名前
            <input type="text" name="newWorkspaceName" required className={styles.field} />
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
          メールアドレス（任意。指定するとこのアドレスでしか登録できない）
          <input type="email" name="email" className={styles.field} />
        </label>
        <p aria-live="polite" className={styles.error}>
          {state.error}
        </p>
        <button type="submit" disabled={pending} className={styles.button}>
          {pending ? "発行しています…" : "招待リンクを発行"}
        </button>
      </form>

      {state.link && (
        <div>
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
