"use client";

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
const CONTRAST_CHECKS: { text: ThemeKey; on: ThemeKey; label: string }[] = [
  { text: "primary", on: "background", label: "プライマリの文字 × 背景" },
  { text: "primary", on: "primaryLight", label: "プライマリの文字 × サイドバー" },
  { text: "muted", on: "background", label: "補助テキスト × 背景" },
];

export function ThemeForm({ current }: { current: ThemeColors }) {
  const [state, formAction, pending] = useActionState(saveTheme, {} as ThemeState);
  // What the fields show; may be half-typed. The preview uses the valid ones.
  const [draft, setDraft] = useState<Record<ThemeKey, string>>(current);
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
              aria-label={`${t.label}の色を選ぶ`}
              value={valid[t.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [t.key]: e.target.value }))}
              className={themeStyles.picker}
              data-ui="ThemeForm.picker"
              data-key={t.key}
            />
            <label className={themeStyles.label}>
              <span>
                {t.label}
                <span className={themeStyles.default}>（初期値 {t.defaultValue.toUpperCase()}）</span>
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
              <span className={styles.note}>{t.description}</span>
            </label>
          </div>
        ))}
      </div>

      <div className={themeStyles.preview} style={previewVars} data-ui="ThemeForm.preview" aria-label="プレビュー">
        <div className={themeStyles.previewSidebar}>
          <div className={themeStyles.previewBrand}>yosuga</div>
          <div className={themeStyles.previewItemCurrent}>開いているページ</div>
          <div className={themeStyles.previewItem}>ほかのページ</div>
        </div>
        <div className={themeStyles.previewMain}>
          <div className={themeStyles.previewTitle}>ページのタイトル</div>
          <p>本文の文字はこの色になります。</p>
          <p className={themeStyles.previewMuted}>補助テキスト（更新日時・説明文など）</p>
          <span className={themeStyles.previewButton}>ボタン</span>
        </div>
      </div>

      {lowContrast.length > 0 && (
        <p className={styles.error} data-ui="ThemeForm.contrastWarning">
          文字が読みにくい組み合わせがあります（推奨はコントラスト比 4.5 以上）:{" "}
          {lowContrast.map((c) => `${c.label} ${c.ratio.toFixed(1)}`).join("、")}
        </p>
      )}

      <p data-ui="ThemeForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。すべての画面に反映されます。" : "")}
      </p>
      <div className={styles.actions}>
        <button
          data-ui="ThemeForm.resetButton"
          type="button"
          className={styles.buttonSecondary}
          onClick={() => setDraft(DEFAULT_THEME)}
        >
          初期値に戻す
        </button>
        <button data-ui="ThemeForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? "保存しています…" : "保存"}
        </button>
      </div>
    </form>
  );
}
