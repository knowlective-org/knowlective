"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { showConfirm } from "@/components/dialog";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { confirmEmailChangeByAdmin, declineEmailChangeByAdmin, resendEmailChangeByAdminCode } from "./profile-actions";

// A change of address an administrator asked for: the code mailed to the new
// address changes it (lib/auth/admin-email-change.ts).
export function AdminEmailChange({
  newEmail,
  expiresAt,
  canResend,
  onChanged,
}: {
  newEmail: string;
  expiresAt: string;
  canResend: boolean;
  onChanged: (email: string) => void;
}) {
  const t = useTranslations("account.profile.adminChange");
  const format = useFormatter();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function run(job: () => Promise<void>) {
    setError(null);
    setResent(false);
    setPending(true);
    try {
      await job();
    } finally {
      setPending(false);
    }
  }

  const confirm = () =>
    run(async () => {
      const result = await confirmEmailChangeByAdmin(code);
      if ("error" in result) setError(result.error);
      else onChanged(result.email);
    });

  const resend = () =>
    run(async () => {
      const result = await resendEmailChangeByAdminCode();
      if ("error" in result) setError(result.error);
      else {
        setCode("");
        setResent(true);
      }
    });

  const decline = async () => {
    if (!(await showConfirm(t("declineConfirm", { email: newEmail }), { danger: true }))) return;
    await run(async () => {
      await declineEmailChangeByAdmin();
      router.refresh();
    });
  };

  return (
    <form
      className={styles.form}
      data-ui="AdminEmailChange"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <p className={styles.note} data-ui="AdminEmailChange.lead">
        {t("lead", { email: newEmail, expires: format.dateTime(new Date(expiresAt), { dateStyle: "medium", timeStyle: "short" }) })}
      </p>
      {resent && (
        <p className={styles.success} data-ui="AdminEmailChange.status">
          {t("resent", { email: newEmail })}
        </p>
      )}
      <label>
        {t("code")}
        <input
          className={styles.field}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          data-ui="AdminEmailChange.codeInput"
        />
      </label>
      <StatusRow message={error} className={styles.error} dataUi="AdminEmailChange.error">
        <button
          type="button"
          className={styles.buttonSecondary}
          disabled={pending}
          onClick={() => void decline()}
          data-ui="AdminEmailChange.declineButton"
        >
          {t("declineButton")}
        </button>
        {canResend && (
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={pending}
            onClick={() => void resend()}
            data-ui="AdminEmailChange.resendButton"
          >
            {t("resendButton")}
          </button>
        )}
        <button type="submit" className={styles.button} disabled={pending} data-ui="AdminEmailChange.confirmButton">
          {t("confirmButton")}
        </button>
      </StatusRow>
    </form>
  );
}
