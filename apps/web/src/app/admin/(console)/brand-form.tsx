"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { Brand } from "@/components/brand";
import { StatusRow } from "@/components/status-row";
import type { Brand as BrandSettings } from "@/lib/brand";
import styles from "@/styles/ui.module.css";
import { type BrandState, saveBrandSettings } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

// The site's name or logo at the top left of the sidebars.
export function BrandForm({ current, maxNameLength }: { current: BrandSettings; maxNameLength: number }) {
  const [state, formAction, pending] = useActionState(saveBrandSettings, {} as BrandState);
  const ta = useTranslations("admin.brand");
  const tc = useTranslations("admin.common");
  const [mode, setMode] = useState(current.mode);
  const [name, setName] = useState(current.name);

  return (
    // Submitted by hand (see LinkPreviewSettingsForm): an action form would
    // reset the radios.
    <form
      data-ui="BrandForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 8 }}>
        <legend style={{ marginBottom: 8 }}>{ta("mode")}</legend>
        {(["TEXT", "IMAGE"] as const).map((m) => (
          <label key={m} style={checkRow}>
            <input
              type="radio"
              name="mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              data-ui="BrandForm.modeRadio"
              data-id={m}
            />
            <span>
              {ta(`modes.${m}`)}
              <span className={styles.note} style={{ display: "block" }}>
                {ta(`modeNotes.${m}`)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        {ta("name")}
        <input
          name="name"
          className={styles.field}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={maxNameLength}
          required
          data-ui="BrandForm.nameInput"
        />
        <span className={styles.note}>{mode === "IMAGE" ? ta("nameNoteImage") : ta("nameNoteText")}</span>
      </label>
      {mode === "IMAGE" && (
        <label>
          {current.logoVersion ? ta("replaceLogo") : ta("logo")}
          <input
            type="file"
            name="logo"
            accept=".svg,image/svg+xml"
            className={styles.field}
            data-ui="BrandForm.logoInput"
          />
          <span className={styles.note}>{ta("logoNote")}</span>
        </label>
      )}
      <div data-ui="BrandForm.preview">
        <span className={styles.note}>{ta("current")}</span>
        <div style={{ maxWidth: 260, paddingTop: 8 }}>
          <Brand brand={current} />
        </div>
      </div>
      <StatusRow
        message={state.error ?? (state.saved ? tc("saved") : "")}
        className={state.error ? styles.error : styles.success}
        dataUi="BrandForm.status"
      >
        <button data-ui="BrandForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? tc("saving") : tc("save")}
        </button>
      </StatusRow>
    </form>
  );
}
