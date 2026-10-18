"use client";

import { startTransition, useActionState, useState } from "react";
import { showConfirm } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { type PublicPagesSettingState, savePublicPagesSetting } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

export function PublicPagesForm({
  allowed,
  searchEnginesAllowed,
  publicCount,
  landingPageId,
  landingOptions,
}: {
  allowed: boolean;
  searchEnginesAllowed: boolean;
  publicCount: number;
  // The landing page set, and the public pages it can be.
  landingPageId: string | null;
  landingOptions: { id: string; label: string }[];
}) {
  const landingIsPublic = landingPageId === null || landingOptions.some((o) => o.id === landingPageId);
  const [state, formAction, pending] = useActionState(savePublicPagesSetting, {} as PublicPagesSettingState);
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
      <label style={checkRow}>
        <input
          type="checkbox"
          name="noindex"
          checked={noindex}
          onChange={(e) => setNoindex(e.target.checked)}
          data-ui="PublicPagesForm.noindexCheckbox"
        />
        <span>
          検索エンジンに載せない
          <span className={styles.note} style={{ display: "block" }}>
            オンの間は、サイトのすべてのページと添付ファイルに「検索結果に載せない」という指示（X-Robots-Tag: noindex）を付けます。
            公開したページは検索では見つからず、URL を知っている人やリンクをたどってきた人だけが開くことになります。
            主な検索エンジンはこの指示に従いますが、従うかどうかは検索エンジン次第です（見られたくないページは公開しないでください）。
            オフにすると、公開したページが Google などの検索結果に出ることがあります。
          </span>
        </span>
      </label>
      <label>
        ログインしていない人のトップページ
        <select
          name="landingPageId"
          defaultValue={landingPageId ?? ""}
          className={styles.field}
          data-ui="PublicPagesForm.landingPageSelect"
        >
          <option value="">なし（ログイン画面）</option>
          {!landingIsPublic && <option value={landingPageId!}>（今は公開されていないページ）</option>}
          {landingOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <span className={styles.note}>
          ログインしていない人がサイトのトップ（/）を開いたときに表示する、公開しているページです。ログインしている人は、これまでどおり前回開いたページに移ります。
          {!landingIsPublic && " 選んでいるページは今は公開されていないため、ログイン画面を表示しています。"}
          {landingIsPublic && landingPageId && !allowed && " ページの公開を許可していない間は、ログイン画面を表示します。"}
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
