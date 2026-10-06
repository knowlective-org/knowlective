"use client";

import { startTransition, useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { type SignupSettingsState, saveSignupSettings } from "./actions";

export function SignupSettingsForm({
  mode,
  allowedDomains,
  siteRole,
  roleLabels,
  mailConfigured,
}: {
  mode: "INVITE_ONLY" | "OPEN";
  allowedDomains: string[];
  siteRole: "USER" | "CONTENT_MANAGER";
  // From the server: lib/roles imports the database client, so it can't be
  // imported into this client component.
  roleLabels: Record<"USER" | "CONTENT_MANAGER", string>;
  mailConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveSignupSettings, {} as SignupSettingsState);
  const [selected, setSelected] = useState(mode);
  const [role, setRole] = useState(siteRole);

  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which put the radios and select back to their initial values.
    <form
      data-ui="SignupSettingsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <fieldset style={{ border: 0, display: "grid", gap: 8 }}>
        <legend style={{ marginBottom: 8 }}>アカウントの作り方</legend>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="mode"
            value="INVITE_ONLY"
            checked={selected === "INVITE_ONLY"}
            onChange={() => setSelected("INVITE_ONLY")}
            data-ui="SignupSettingsForm.inviteOnly"
          />
          <span>
            招待のみ
            <span className={styles.note} style={{ display: "block" }}>
              管理者が発行した招待リンクからだけ登録できます。
            </span>
          </span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="mode"
            value="OPEN"
            checked={selected === "OPEN"}
            onChange={() => setSelected("OPEN")}
            disabled={!mailConfigured && mode !== "OPEN"}
            data-ui="SignupSettingsForm.open"
          />
          <span>
            誰でも登録できる（メールアドレスの確認あり）
            <span className={styles.note} style={{ display: "block" }}>
              ログイン画面の「アカウント登録」からメールアドレスを入力すると、登録用のリンクがメールで届きます。
              登録した人は下で選ぶロールになり、どのグループにも入りません（「全ユーザー」に公開されたページだけが見えます）。
              {!mailConfigured && " ※ 先に「概要」でメール送信を設定してください。"}
            </span>
          </span>
        </label>
      </fieldset>

      {selected === "OPEN" && (
        <label>
          登録した人のロール
          <select
            name="siteRole"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className={styles.field}
            data-ui="SignupSettingsForm.siteRole"
          >
            <option value="USER">{roleLabels.USER}（初期値）</option>
            <option value="CONTENT_MANAGER">{roleLabels.CONTENT_MANAGER}</option>
          </select>
          <span className={styles.note}>
            コンテンツ管理者は、ナレッジルートの作成や、ユーザーの招待・グループの管理（自分が管理するページの範囲）ができます。サイト管理者は選べません。
          </span>
        </label>
      )}

      {selected === "OPEN" && (
        <label>
          登録できるメールアドレスのドメイン（任意）
          <textarea
            name="domains"
            rows={3}
            defaultValue={allowedDomains.join("\n")}
            placeholder={"example.co.jp\nexample.com"}
            className={styles.field}
            spellCheck={false}
            data-ui="SignupSettingsForm.domains"
          />
          <span className={styles.note}>
            1行に1つ（またはカンマ区切り）。空欄なら、どのドメインでも登録できます。サブドメインは別に書いてください。
          </span>
        </label>
      )}

      <p data-ui="SignupSettingsForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button data-ui="SignupSettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}
