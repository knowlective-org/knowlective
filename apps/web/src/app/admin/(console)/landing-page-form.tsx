"use client";

import { useActionState } from "react";
import type { LandingPageOption } from "@/lib/landing-page";
import styles from "@/styles/ui.module.css";
import { type LandingPageSettingState, saveLandingPage } from "./actions";

export function LandingPageForm({
  landingPageId,
  options,
  guestsCanView,
}: {
  landingPageId: string | null;
  // The pages this admin can pick (see landingPageOptions()).
  options: LandingPageOption[];
  // Whether someone not logged in can open the page set, right now.
  guestsCanView: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveLandingPage, {} as LandingPageSettingState);
  const known = landingPageId === null || options.some((o) => o.id === landingPageId);

  return (
    <form data-ui="LandingPageForm" action={formAction} className={styles.form}>
      <label>
        トップページ
        <select
          name="landingPageId"
          defaultValue={landingPageId ?? ""}
          className={styles.field}
          data-ui="LandingPageForm.pageSelect"
        >
          <option value="">なし</option>
          {!known && <option value={landingPageId!}>（あなたが見られないページ）</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.public && "（公開）"}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.note} data-ui="LandingPageForm.guestStatus">
        {landingPageId === null
          ? "ログインしていない人には、ログイン画面を表示します。"
          : guestsCanView
            ? "ログインしていない人にも、このページを表示します。"
            : "このページは公開されていない（またはページの公開を許可していない）ため、ログインしていない人にはログイン画面を表示します。"}
      </p>

      <p data-ui="LandingPageForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button data-ui="LandingPageForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}
