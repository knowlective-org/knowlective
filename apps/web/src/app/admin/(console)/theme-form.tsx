"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, type CSSProperties } from "react";
import styles from "@/styles/ui.module.css";
import {
  DEFAULT_THEME,
  THEME_TOKENS,
  contrastRatio,
  normalizeColor,
  type ThemeColors,
  type ThemeKey,
} from "@/lib/theme-tokens";
import { type ThemeState, saveTheme } from "./actions";
import themeStyles from "./theme-form.module.css";

// Pairs that must stay readable (WCAG AA for normal text: 4.5:1).
// Named by admin.theme.pairs.<label>.
const CONTRAST_CHECKS: { text: ThemeKey; on: ThemeKey; label: "primaryOnBackground" | "primaryOnSidebar" | "mutedOnBackground" }[] = [
  { text: "primary", on: "background", label: "primaryOnBackground" },
  { text: "primary", on: "primaryLight", label: "primaryOnSidebar" },
  { text: "muted", on: "background", label: "mutedOnBackground" },
];

export function ThemeForm({ current }: { current: ThemeColors }) {
  const [state, formAction, pending] = useActionState(saveTheme, {} as ThemeState);
  // What the fields show; may be half-typed. The preview uses the valid ones.
  const [draft, setDraft] = useState<Record<ThemeKey, string>>(current);
  const tr = useTranslations("admin");
  const valid = Object.fromEntries(
    THEME_TOKENS.map((t) => [t.key, normalizeColor(draft[t.key]) ?? current[t.key]]),
  ) as ThemeColors;
  const previewVars = Object.fromEntries(THEME_TOKENS.map((t) => [t.cssVar, valid[t.key]])) as CSSProperties;
  const lowContrast = CONTRAST_CHECKS.map((c) => ({ ...c, ratio: contrastRatio(valid[c.text], valid[c.on]) })).filter(
    (c) => c.ratio < 4.5,
  );

  return (
    <form data-ui="ThemeForm" action={formAction} className={styles.form}>
      <div className={themeStyles.fields}>
        {THEME_TOKENS.map((t) => (
          <div key={t.key} className={themeStyles.field}>
            <input
              type="color"
              aria-label={tr("theme.pick", { label: tr(`theme.tokens.${t.key}`) })}
              value={valid[t.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [t.key]: e.target.value }))}
              className={themeStyles.picker}
              data-ui="ThemeForm.picker"
              data-key={t.key}
            />
            <label className={themeStyles.label}>
              <span>
                {tr(`theme.tokens.${t.key}`)}
                <span className={themeStyles.default}>{tr("theme.defaultValue", { value: t.defaultValue.toUpperCase() })}</span>
              </span>
              <input
                name={t.key}
                value={draft[t.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [t.key]: e.target.value }))}
                pattern="#[0-9A-Fa-f]{6}"
                required
                spellCheck={false}
                className={`${styles.field} ${themeStyles.hex}`}
                data-ui="ThemeForm.hexInput"
                data-key={t.key}
              />
              <span className={styles.note}>{tr(`theme.tokens.${t.key}Description`)}</span>
            </label>
          </div>
        ))}
      </div>

      <div className={themeStyles.preview} style={previewVars} data-ui="ThemeForm.preview" aria-label={tr("theme.preview")}>
        <div className={themeStyles.previewSidebar}>
          <div className={themeStyles.previewBrand}>KNOWLECTIVE</div>
          <div className={themeStyles.previewItemCurrent}>{tr("theme.previewCurrent")}</div>
          <div className={themeStyles.previewItem}>{tr("theme.previewOther")}</div>
        </div>
        <div className={themeStyles.previewMain}>
          <div className={themeStyles.previewTitle}>{tr("theme.previewTitle")}</div>
          <p>{tr("theme.previewBody")}</p>
          <p className={themeStyles.previewMuted}>{tr("theme.previewMuted")}</p>
          <span className={themeStyles.previewButton}>{tr("theme.previewButton")}</span>
        </div>
      </div>

      {lowContrast.length > 0 && (
        <p className={styles.error} data-ui="ThemeForm.contrastWarning">
          {tr("theme.lowContrast")}
          {lowContrast.map((c) => `${tr(`theme.pairs.${c.label}`)} ${c.ratio.toFixed(1)}`).join(", ")}
        </p>
      )}

      <p data-ui="ThemeForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? tr("theme.saved") : "")}
      </p>
      <div className={styles.actions}>
        <button
          data-ui="ThemeForm.resetButton"
          type="button"
          className={styles.buttonSecondary}
          onClick={() => setDraft(DEFAULT_THEME)}
        >
          {tr("theme.reset")}
        </button>
        <button data-ui="ThemeForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? tr("common.saving") : tr("common.save")}
        </button>
      </div>
    </form>
  );
}
