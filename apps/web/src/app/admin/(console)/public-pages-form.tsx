"use client";

import { startTransition, useActionState, useState } from "react";
import { showConfirm } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { type PublicPagesSettingState, savePublicPagesSetting } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

export function PublicPagesForm({ allowed, publicCount }: { allowed: boolean; publicCount: number }) {
  const [state, formAction, pending] = useActionState(savePublicPagesSetting, {} as PublicPagesSettingState);
  const [checked, setChecked] = useState(allowed);

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
            "ページの「管理」の権限を持つ人が、ページをインターネットに公開できるようになります。公開したページとその下のページは、ログインしていない人を含め、URL を知っている誰でも読めます。",
            { title: "ページの公開を許可しますか？", confirmLabel: "許可する", danger: true },
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
          ページの公開を許可する
          <span className={styles.note} style={{ display: "block" }}>
            許可すると、ページの「権限設定」に「インターネットに公開」が出て、「管理」の権限を持つ人がページを公開できます。
            公開したページ（と、その下のページ）は、ログインしていない人も閲覧だけできます。自分専用のナレッジルート（マイページ）は公開できません。
            許可をやめると、公開しているページはすぐにログインしないと見られなくなります（公開の設定は残り、もう一度許可すると元に戻ります）。
          </span>
        </span>
      </label>
      <p className={styles.note} data-ui="PublicPagesForm.count">
        公開の設定が付いているページ：{publicCount}件{publicCount > 0 && !allowed && "（今は許可していないため、公開されていません）"}
      </p>

      <p data-ui="PublicPagesForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button data-ui="PublicPagesForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}
