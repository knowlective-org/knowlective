"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { MASK, MAX_MASK_STRINGS, MIN_MASK_LENGTH } from "@/lib/version-mask";
import styles from "@/styles/ui.module.css";
import { applyMask, checkMask } from "./actions";
import historyStyles from "./history.module.css";
import { showConfirm } from "@/components/dialog";

type Check = { versions: number; matches: number; inCurrent: boolean };

// Masking confidential text: replaces text (one string per line) with ●●●● in every
// saved version of the page. Search first, then apply. Masked versions stay
// in the history (shown masked) but can't be restored.
export function MaskPanel({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  // Result of the last search, for the text it was run on.
  const [check, setCheck] = useState<{ input: string; result: Check } | null>(null);
  const [message, setMessage] = useState<{ error?: string; done?: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const t = useTranslations("history.mask");

  const strings = input.split("\n").filter((s) => s.length > 0);
  const current = check && check.input === input ? check.result : null;

  if (!open) {
    return (
      <button type="button" className={styles.buttonSecondary} onClick={() => setOpen(true)} data-ui="MaskPanel.openButton">
        {t("open")}
      </button>
    );
  }

  const close = () => {
    setOpen(false);
    setInput("");
    setCheck(null);
    setMessage(null);
  };

  return (
    <div className={historyStyles.maskPanel} data-ui="MaskPanel">
      <p className={styles.note}>
        {t("explain", { mask: MASK })} {t("explain2")}
      </p>
      <label className={historyStyles.maskLabel}>
        {t("label", { max: MAX_MASK_STRINGS, min: MIN_MASK_LENGTH })}
        <textarea
          className={styles.field}
          rows={3}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setMessage(null);
          }}
          autoComplete="off"
          spellCheck={false}
          data-ui="MaskPanel.input"
        />
      </label>

      {current && (
        <p className={current.inCurrent ? styles.error : styles.note} data-ui="MaskPanel.result">
          {current.versions === 0
            ? t("notFound")
            : t("found", { versions: current.versions, matches: current.matches })}
          {current.inCurrent && t("stillInPage")}
        </p>
      )}
      {message?.error && <p className={styles.error}>{message.error}</p>}
      {message?.done && (
        <p className={styles.success} data-ui="MaskPanel.done">
          {message.done}
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.buttonSecondary} onClick={close}>
          {t("close")}
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          disabled={busy || strings.length === 0}
          data-ui="MaskPanel.checkButton"
          onClick={() =>
            startTransition(async () => {
              const result = await checkMask(pageId, strings);
              if ("error" in result) setMessage({ error: result.error });
              else setCheck({ input, result });
            })
          }
        >
          {t("search")}
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={busy || !current || current.inCurrent || current.versions === 0}
          data-ui="MaskPanel.applyButton"
          onClick={async () => {
            if (!current) return;
            const ok = await showConfirm(
              t("confirm", { versions: current.versions, matches: current.matches }),
              { title: t("confirmTitle"), confirmLabel: t("confirmLabel"), danger: true },
            );
            if (!ok) return;
            startTransition(async () => {
              const result = await applyMask(pageId, strings);
              if ("error" in result) {
                setMessage({ error: result.error });
                return;
              }
              setInput("");
              setCheck(null);
              setMessage({ done: t("done", { versions: result.versions, matches: result.matches }) });
              onDone();
            });
          }}
        >
          {t("run")}
        </button>
      </div>
    </div>
  );
}
