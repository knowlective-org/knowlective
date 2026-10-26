"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { type ConfirmEmailChangeState, confirmEmailChange } from "./actions";

export function ConfirmEmailChangeForm({ token }: { token: string }) {
  const t = useTranslations("emailChange");
  const [state, formAction, pending] = useActionState(confirmEmailChange, {} as ConfirmEmailChangeState);

  if (state.done) {
    return (
      <div data-ui="ConfirmEmailChangeForm.done">
        <p className={styles.success}>{t("done", { email: state.done })}</p>
        <p className={styles.note}>
          <Link href="/account" data-ui="ConfirmEmailChangeForm.accountLink">
            {t("toAccount")}
          </Link>
        </p>
      </div>
    );
  }
  return (
    <form action={formAction} className={styles.form} data-ui="ConfirmEmailChangeForm">
      <input type="hidden" name="token" value={token} />
      <StatusRow message={state.error} className={styles.error} dataUi="ConfirmEmailChangeForm.error">
        <button type="submit" disabled={pending} className={styles.button} data-ui="ConfirmEmailChangeForm.submitButton">
          {t("confirm")}
        </button>
      </StatusRow>
    </form>
  );
}
