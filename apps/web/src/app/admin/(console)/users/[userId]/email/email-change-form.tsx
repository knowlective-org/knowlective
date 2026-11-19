"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { confirmBeforeSubmit } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { type AdminEmailChangeState, cancelUserEmailChange, requestUserEmailChange } from "../../actions";

export function AdminEmailChangeForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(requestUserEmailChange, {} as AdminEmailChangeState);
  const t = useTranslations("admin.emailChange");

  return (
    <form data-ui="AdminEmailChangeForm" action={formAction} className={styles.form}>
      <input type="hidden" name="userId" value={userId} />
      <label>
        {t("newEmail")}
        <input
          type="email"
          name="newEmail"
          required
          autoComplete="off"
          className={styles.field}
          data-ui="AdminEmailChangeForm.newEmailInput"
        />
      </label>
      <p data-ui="AdminEmailChangeForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      {state.sentTo && (
        <p data-ui="AdminEmailChangeForm.status" className={styles.success}>
          {t("sent", { email: state.sentTo })}
        </p>
      )}
      <button data-ui="AdminEmailChangeForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? t("sending") : t("submit")}
      </button>
    </form>
  );
}

export function CancelEmailChangeForm({ userId, email }: { userId: string; email: string }) {
  const t = useTranslations("admin.emailChange");
  return (
    <form
      data-ui="CancelEmailChangeForm"
      action={cancelUserEmailChange}
      onSubmit={(e) => confirmBeforeSubmit(e, t("cancelConfirm", { email }), { danger: true })}
    >
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className={styles.buttonSecondary} data-ui="CancelEmailChangeForm.cancelButton">
        {t("cancel")}
      </button>
    </form>
  );
}
