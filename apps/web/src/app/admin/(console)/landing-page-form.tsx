"use client";

import { useTranslations } from "next-intl";
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
  const ta = useTranslations("admin");
  const known = landingPageId === null || options.some((o) => o.id === landingPageId);

  return (
    <form data-ui="LandingPageForm" action={formAction} className={styles.form}>
      <label>
        {ta("landing.label")}
        <select
          name="landingPageId"
          defaultValue={landingPageId ?? ""}
          className={styles.field}
          data-ui="LandingPageForm.pageSelect"
        >
          <option value="">{ta("landing.none")}</option>
          {!known && <option value={landingPageId!}>{ta("landing.hidden")}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.public && ta("landing.publicSuffix")}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.note} data-ui="LandingPageForm.guestStatus">
        {landingPageId === null
          ? ta("landing.guestNone")
          : guestsCanView
            ? ta("landing.guestShown")
            : ta("landing.guestLogin")}
      </p>

      <p data-ui="LandingPageForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="LandingPageForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}
