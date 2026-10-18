"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { accept, register, type InviteState } from "./actions";

const initialState: InviteState = {};

export function RegisterForm({
  token,
  email,
  minLength,
}: {
  token: string;
  email: string | null;
  minLength: number;
}) {
  const [state, formAction, pending] = useActionState(register, initialState);
  const t = useTranslations();

  return (
    <form action={formAction} className={styles.form} data-ui="RegisterForm">
      <input type="hidden" name="token" value={token} />
      <label>
        {t("common.email")}
        <input
          data-ui="RegisterForm.emailInput"
          type="email"
          name="email"
          required
          autoComplete="username"
          defaultValue={email ?? ""}
          readOnly={email !== null}
          className={styles.field}
        />
      </label>
      <label>
        {t("common.displayName")}
        <input data-ui="RegisterForm.nameInput" type="text" name="name" required autoComplete="name" className={styles.field} />
      </label>
      <label>
        {t("common.passwordWithMin", { min: minLength })}
        <input
          data-ui="RegisterForm.passwordInput"
          type="password"
          name="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          className={styles.field}
        />
      </label>
      <label>
        {t("common.confirmPassword")}
        <input
          data-ui="RegisterForm.confirmPasswordInput"
          type="password"
          name="confirm"
          required
          minLength={minLength}
          autoComplete="new-password"
          className={styles.field}
        />
      </label>
      <p aria-live="polite" className={styles.error} data-ui="RegisterForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="RegisterForm.submitButton">
        {pending ? t("invite.registering") : t("invite.register")}
      </button>
    </form>
  );
}

export function AcceptForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(accept, initialState);
  const t = useTranslations("invite");

  return (
    <form action={formAction} className={styles.form} data-ui="AcceptForm">
      <input type="hidden" name="token" value={token} />
      <p aria-live="polite" className={styles.error} data-ui="AcceptForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="AcceptForm.submitButton">
        {pending ? t("accepting") : t("accept")}
      </button>
    </form>
  );
}
