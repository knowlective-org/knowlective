"use client";

import { useState, useTransition } from "react";
import { MASK, MAX_MASK_STRINGS, MIN_MASK_LENGTH } from "@/lib/version-mask";
import styles from "@/styles/ui.module.css";
import { applyMask, checkMask } from "./actions";
import historyStyles from "./history.module.css";
import { showConfirm } from "@/components/dialog";

type Check = { versions: number; matches: number; inCurrent: boolean };

// 「機密情報をマスク」: replaces text (one string per line) with ●●●● in every
// saved version of the page. Search first, then apply. Masked versions stay
// in the history (shown masked) but can't be restored.
export function MaskPanel({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  // Result of the last search, for the text it was run on.
  const [check, setCheck] = useState<{ input: string; result: Check } | null>(null);
  const [message, setMessage] = useState<{ error?: string; done?: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const strings = input.split("\n").filter((s) => s.length > 0);
  const current = check && check.input === input ? check.result : null;

  if (!open) {
    return (
      <button type="button" className={styles.buttonSecondary} onClick={() => setOpen(true)} data-ui="MaskPanel.openButton">
        機密情報をマスク
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
        パスワードなど、載せてはいけない内容を書いてしまったときに使います。入力した文字列を、このページのすべての版で「{MASK}」に置き換えます。
        マスクした版は履歴に残り（マスクした状態で表示）、その版には戻せなくなります。入力した文字列は保存・記録されません。
      </p>
      <label className={historyStyles.maskLabel}>
        マスクする文字列（1行に1つ、{MAX_MASK_STRINGS}個まで・{MIN_MASK_LENGTH}文字以上）
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
            ? "履歴の版には見つかりませんでした。"
            : `${current.versions}個の版で${current.matches}か所見つかりました。`}
          {current.inCurrent && " 今のページ（本文またはタイトル）にまだ含まれています。先にページから消してから、マスクしてください。"}
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
          閉じる
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
          検索
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={busy || !current || current.inCurrent || current.versions === 0}
          data-ui="MaskPanel.applyButton"
          onClick={async () => {
            if (!current) return;
            const ok = await showConfirm(
              `${current.versions}個の版の${current.matches}か所をマスクします。マスクした版には戻せなくなります。よろしいですか？`,
              { title: "機密情報のマスク", confirmLabel: "マスクする", danger: true },
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
              setMessage({ done: `${result.versions}個の版の${result.matches}か所をマスクしました。` });
              onDone();
            });
          }}
        >
          マスクを実行
        </button>
      </div>
    </div>
  );
}
