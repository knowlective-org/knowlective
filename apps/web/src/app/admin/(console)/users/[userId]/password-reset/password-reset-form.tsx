"use client";

import { useTranslations } from "next-intl";
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
  const ta = useTranslations("admin");
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
          {ta("passwordReset.sendEmail", { email })}
        </label>
        {!mailConfigured && (
          <p className={styles.note}>
            {ta("passwordReset.mailNotConfigured")}
          </p>
        )}
        <p data-ui="PasswordResetIssueForm.error" aria-live="polite" className={styles.error}>
          {state.error}
        </p>
        <button data-ui="PasswordResetIssueForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? ta("common.issuing") : sendEmail ? ta("passwordReset.issueAndSend") : ta("passwordReset.issue")}
        </button>
      </form>

      {state.link && (
        <div>
          {state.mailSentTo && (
            <p data-ui="PasswordResetIssueForm.mailSentMessage" className={styles.success}>
              {ta("passwordReset.sent", { email: state.mailSentTo })}
            </p>
          )}
          {state.mailError && (
            <p data-ui="PasswordResetIssueForm.mailError" className={styles.error}>
              {ta("passwordReset.sendFailed", { error: state.mailError })}
            </p>
          )}
          <p className={styles.note}>
            {ta("passwordReset.linkNote", { hours: ttlHours })}
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
            {copied ? ta("common.copied") : ta("common.copy")}
          </button>
        </div>
      )}
    </div>
  );
}
