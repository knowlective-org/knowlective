"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const t = useTranslations();

  return (
    <form action={formAction} className={styles.form} data-ui="LoginForm">
      <input type="hidden" name="next" value={next} />
      <label>
        {t("common.email")}
        <input
          data-ui="LoginForm.emailInput"
          type="email"
          name="email"
          required
          autoComplete="username"
          defaultValue={state.email}
          className={styles.field}
        />
      </label>
      <label>
        {t("common.password")}
        <input
          data-ui="LoginForm.passwordInput"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={styles.field}
        />
      </label>
      <p aria-live="polite" className={styles.error} data-ui="LoginForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="LoginForm.submitButton">
        {pending ? t("login.submitting") : t("login.submit")}
      </button>
      <p className={styles.note}>
        <Link href="/forgot-password" data-ui="LoginForm.forgotPasswordLink">{t("login.forgotPasswordLink")}</Link>
      </p>
    </form>
  );
}
