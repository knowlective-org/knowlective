"use client";

import { useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { issuePasswordReset, type PasswordResetIssueState } from "../../actions";

export function PasswordResetIssueForm({
  userId,
  email,
  ttlHours,
  mailConfigured,
}: {
  userId: string;
  email: string;
  ttlHours: number;
  mailConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(issuePasswordReset, {} as PasswordResetIssueState);
  const [copied, setCopied] = useState(false);
  const [sendEmail, setSendEmail] = useState(mailConfigured);

  return (
    <div data-ui="PasswordResetIssueForm" className={styles.form}>
      <form data-ui="PasswordResetIssueForm.form" action={formAction} className={styles.form} onSubmit={() => setCopied(false)}>
        <input type="hidden" name="userId" value={userId} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            data-ui="PasswordResetIssueForm.sendEmailCheckbox"
            name="sendEmail"
            checked={sendEmail}
            disabled={!mailConfigured}
            onChange={(e) => setSendEmail(e.target.checked)}
          />
          {email} にメールで送る
        </label>
        {!mailConfigured && (
          <p className={styles.note}>
            メール送信が未設定のため、送信できません。発行したリンクを本人に直接渡してください。
          </p>
        )}
        <p data-ui="PasswordResetIssueForm.error" aria-live="polite" className={styles.error}>
          {state.error}
        </p>
        <button data-ui="PasswordResetIssueForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? "発行しています…" : sendEmail ? "再設定リンクを発行してメールで送る" : "再設定リンクを発行"}
        </button>
      </form>

      {state.link && (
        <div>
          {state.mailSentTo && (
            <p data-ui="PasswordResetIssueForm.mailSentMessage" className={styles.success}>
              {state.mailSentTo} に再設定のメールを送信しました。
            </p>
          )}
          {state.mailError && (
            <p data-ui="PasswordResetIssueForm.mailError" className={styles.error}>
              メールの送信に失敗しました（{state.mailError}）。リンクは有効なので、下のリンクを直接渡してください。
            </p>
          )}
          <p className={styles.note}>
            再設定リンクは今だけ表示されます（{ttlHours}時間有効・1回限り）。本人だけに渡してください。
          </p>
          <p data-ui="PasswordResetIssueForm.resetLink" className={styles.secret}>{state.link}</p>
          <button
            data-ui="PasswordResetIssueForm.copyButton"
            type="button"
            className={styles.buttonSecondary}
            style={{ display: "block", marginTop: 8, marginLeft: "auto" }}
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
