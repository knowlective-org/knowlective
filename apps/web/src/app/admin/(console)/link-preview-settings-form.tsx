"use client";

import { startTransition, useActionState, useState } from "react";
import type { LinkPreviewSettingsView } from "@/lib/link-preview-settings";
import styles from "@/styles/ui.module.css";
import { type LinkPreviewSettingsState, saveLinkPreviewSettings } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

export function LinkPreviewSettingsForm({ current }: { current: LinkPreviewSettingsView }) {
  const [state, formAction, pending] = useActionState(saveLinkPreviewSettings, {} as LinkPreviewSettingsState);
  const [enabled, setEnabled] = useState(current.enabled);
  const [allowPrivate, setAllowPrivate] = useState(current.allowPrivate);
  const [proxyUrl, setProxyUrl] = useState(current.proxyUrl ?? "");

  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which would put the checkboxes back to their initial values.
    <form
      data-ui="LinkPreviewSettingsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <label style={checkRow}>
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-ui="LinkPreviewSettingsForm.enabledCheckbox"
        />
        <span>
          リンクのプレビューを使う
          <span className={styles.note} style={{ display: "block" }}>
            オフにすると、貼り付けた URL は普通のリンクになり、サーバーは外部のサイトへ取りに行きません。すでにあるカードはそのまま表示されます。
          </span>
        </span>
      </label>

      <label style={checkRow}>
        <input
          type="checkbox"
          name="allowPrivate"
          checked={allowPrivate}
          disabled={!enabled}
          onChange={(e) => setAllowPrivate(e.target.checked)}
          data-ui="LinkPreviewSettingsForm.allowPrivateCheckbox"
        />
        <span>
          社内（イントラネット）のサイトも対象にする
          <span className={styles.note} style={{ display: "block" }}>
            プライベートアドレス（10.x、172.16〜31.x、192.168.x など）のサイトからも取得します。
            ログインしている利用者なら誰でも、このサーバーから届く社内のサイトのタイトルや説明を見られるようになります。
            このサーバー自身（localhost）と、クラウドの管理用アドレス（169.254.x）は、オンにしても対象になりません。
          </span>
        </span>
      </label>

      <label>
        プロキシ（任意）
        <input
          type="url"
          name="proxyUrl"
          value={proxyUrl}
          onChange={(e) => setProxyUrl(e.target.value)}
          disabled={!enabled}
          placeholder="http://proxy.example.co.jp:8080"
          spellCheck={false}
          autoComplete="off"
          className={styles.field}
          data-ui="LinkPreviewSettingsForm.proxyUrlInput"
        />
        <span className={styles.note}>
          サーバーが外部へ直接つなげない環境で、取得に使う HTTP プロキシです。空欄なら直接つなぎます。
          プロキシを使うと、最終的にどこへつなぐかはプロキシ側の設定で決まります。
        </span>
      </label>

      {enabled && proxyUrl.trim() !== "" && (
        <>
          <label>
            プロキシのユーザー名（任意）
            <input
              type="text"
              name="proxyUsername"
              defaultValue={current.proxyUsername ?? ""}
              autoComplete="off"
              className={styles.field}
              data-ui="LinkPreviewSettingsForm.proxyUsernameInput"
            />
          </label>
          <label>
            プロキシのパスワード
            <input
              type="password"
              name="proxyPassword"
              placeholder={current.hasProxyPassword ? "変更しない場合は空欄" : ""}
              autoComplete="new-password"
              className={styles.field}
              data-ui="LinkPreviewSettingsForm.proxyPasswordInput"
            />
            <span className={styles.note}>暗号化して保存され、画面には表示されません。</span>
          </label>
        </>
      )}

      <p
        data-ui="LinkPreviewSettingsForm.status"
        aria-live="polite"
        className={state.error ? styles.error : styles.success}
      >
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button data-ui="LinkPreviewSettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}
