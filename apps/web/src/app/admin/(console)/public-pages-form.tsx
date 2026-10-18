"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { showConfirm } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { type PublicPagesSettingState, savePublicPagesSetting } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

export function PublicPagesForm({
  allowed,
  searchEnginesAllowed,
  publicCount,
}: {
  allowed: boolean;
  searchEnginesAllowed: boolean;
  publicCount: number;
}) {
  const [state, formAction, pending] = useActionState(savePublicPagesSetting, {} as PublicPagesSettingState);
  const ta = useTranslations("admin");
  const [checked, setChecked] = useState(allowed);
  const [noindex, setNoindex] = useState(!searchEnginesAllowed);

  return (
    // Submitted by hand (see LinkPreviewSettingsForm): an action form would
    // reset the checkbox.
    <form
      data-ui="PublicPagesForm"
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (checked && !allowed) {
          const ok = await showConfirm(
            ta("publicPages.allowConfirm"),
            { title: ta("publicPages.allowTitle"), confirmLabel: ta("publicPages.allowLabel"), danger: true },
          );
          if (!ok) return;
        }
        startTransition(() => formAction(data));
      }}
    >
      <label style={checkRow}>
        <input
          type="checkbox"
          name="allowed"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          data-ui="PublicPagesForm.allowedCheckbox"
        />
        <span>
          {ta("publicPages.allow")}
          <span className={styles.note} style={{ display: "block" }}>
            {ta("publicPages.allowNote")}
          </span>
        </span>
      </label>
      <label style={checkRow}>
        <input
          type="checkbox"
          name="noindex"
          checked={noindex}
          onChange={(e) => setNoindex(e.target.checked)}
          data-ui="PublicPagesForm.noindexCheckbox"
        />
        <span>
          {ta("publicPages.noindex")}
          <span className={styles.note} style={{ display: "block" }}>
            {ta("publicPages.noindexNote")}
          </span>
        </span>
      </label>
      <p className={styles.note} data-ui="PublicPagesForm.count">
        {ta("publicPages.count", { count: publicCount })}
        {publicCount > 0 && !allowed && ta("publicPages.countNotAllowed")}
      </p>

      <p data-ui="PublicPagesForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="PublicPagesForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}
