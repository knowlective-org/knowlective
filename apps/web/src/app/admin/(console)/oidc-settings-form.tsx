"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import styles from "@/styles/ui.module.css";
import {
  type OidcFormState,
  saveOidcSettings,
  testOidcSettings,
} from "./actions";

type Values = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  buttonLabel: string;
  nameClaim: string;
  newUserRole: "USER" | "CONTENT_MANAGER";
  allowedDomains: string[];
  trustEmail: boolean;
  passwordLogin: "ALLOWED" | "SITE_ADMINS_ONLY";
};

export function OidcSettingsForm({
  values,
  callbackUrl,
  roleLabels,
}: {
  values: Values;
  // Redirect URI to register at the IdP.
  callbackUrl: string;
  // From the server: lib/roles can't be imported into a client component.
  roleLabels: Record<"USER" | "CONTENT_MANAGER", string>;
}) {
  const [state, formAction, saving] = useActionState(
    saveOidcSettings,
    {} as OidcFormState,
  );
  const [test, testAction, testing] = useActionState(
    testOidcSettings,
    {} as OidcFormState,
  );
  const [enabled, setEnabled] = useState(values.enabled);
  const formRef = useRef<HTMLFormElement>(null);
  // Submitted by hand, not via `action`, so React doesn't reset the fields.
  const submit = (action: (data: FormData) => void) => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    startTransition(() => action(data));
  };

  return (
    <form
      ref={formRef}
      data-ui="OidcSettingsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit(formAction);
      }}
    >
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-ui="OidcSettingsForm.enabled"
        />
        シングルサインオンを有効にする
      </label>

      {/* The rest only while enabled (hidden, not removed, so typed values
          survive toggling). Saving while off only turns it off. */}
      <div
        className={styles.form}
        // Not the `hidden` attribute: .form's display: grid would override it.
        style={enabled ? undefined : { display: "none" }}
        data-ui="OidcSettingsForm.details"
      >
        <div>
          <div>リダイレクト URI（IdP 側に登録してください）</div>
          <code
            className={styles.secret}
            style={{ display: "block", marginTop: 4 }}
            data-ui="OidcSettingsForm.callbackUrl"
          >
            {callbackUrl}
          </code>
        </div>

        <label>
          Issuer URL
          <input
            name="issuer"
            defaultValue={values.issuer}
            placeholder="https://login.microsoftonline.com/<テナントID>/v2.0"
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.issuer"
          />
          <span className={styles.note}>
            この URL の /.well-known/openid-configuration
            から設定を読み込みます。例: https://accounts.google.com
          </span>
        </label>
        <label>
          クライアント ID
          <input
            name="clientId"
            defaultValue={values.clientId}
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.clientId"
          />
        </label>
        <label>
          クライアントシークレット
          <input
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder={
              values.hasSecret ? "（保存済み。変更する場合だけ入力）" : ""
            }
            className={styles.field}
            data-ui="OidcSettingsForm.clientSecret"
          />
          <span className={styles.note}>
            暗号化して保存し、画面には表示しません。
          </span>
        </label>
        <label>
          ボタンの名前
          <input
            name="buttonLabel"
            defaultValue={values.buttonLabel}
            maxLength={40}
            className={styles.field}
            data-ui="OidcSettingsForm.buttonLabel"
          />
          <span className={styles.note}>
            ログイン画面に「（ボタンの名前）でログイン」と表示します。例:
            社内アカウント
          </span>
        </label>

        <label>
          表示名に使う属性（任意）
          <input
            name="nameClaim"
            defaultValue={values.nameClaim}
            placeholder="name"
            maxLength={100}
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.nameClaim"
          />
          <span className={styles.note}>
            アカウントを作るときの表示名に使う、ID トークン（なければ
            UserInfo）の属性名です。例: name、preferred_username、given_name。
            空欄なら name、なければ preferred_username を使います。
          </span>
        </label>

        <label>
          初めてログインした人のロール
          <select
            name="newUserRole"
            defaultValue={values.newUserRole}
            className={styles.field}
            data-ui="OidcSettingsForm.newUserRole"
          >
            <option value="USER">{roleLabels.USER}（初期値）</option>
            <option value="CONTENT_MANAGER">
              {roleLabels.CONTENT_MANAGER}
            </option>
          </select>
          <span className={styles.note}>
            KNOWLECTIVE
            にアカウントがない人は、初めてのログインでアカウントが作られます（どのグループにも入りません）。
            すでにアカウントがある人は、確認済みのメールアドレスが一致すれば、そのアカウントでログインします。
          </span>
        </label>
        <label>
          アカウントを作成できるメールアドレスのドメイン（任意）
          <textarea
            name="allowedDomains"
            rows={2}
            defaultValue={values.allowedDomains.join("\n")}
            placeholder="example.co.jp"
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.allowedDomains"
          />
          <span className={styles.note}>
            1行に1つ（またはカンマ区切り）。空欄なら、IdP
            でログインできる人は誰でもアカウントが作られます。
          </span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            name="trustEmail"
            defaultChecked={values.trustEmail}
            data-ui="OidcSettingsForm.trustEmail"
          />
          <span>
            IdP のメールアドレスを確認済みとして扱う
            <span className={styles.note} style={{ display: "block" }}>
              IdP が「確認済み（email_verified）」を送ってこない場合（Microsoft
              Entra ID など）にオンにします。
              利用者が自由にメールアドレスを設定できる IdP
              でオンにすると、他人のアカウントに入られるおそれがあります。
            </span>
          </span>
        </label>

        <fieldset style={{ border: 0, display: "grid", gap: 6 }}>
          <legend style={{ marginBottom: 6 }}>パスワードでのログイン</legend>
          <label style={{ display: "flex", gap: 8 }}>
            <input
              type="radio"
              name="passwordLogin"
              value="ALLOWED"
              defaultChecked={values.passwordLogin === "ALLOWED"}
            />
            シングルサインオンと併用する（初期値）
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              type="radio"
              name="passwordLogin"
              value="SITE_ADMINS_ONLY"
              defaultChecked={values.passwordLogin === "SITE_ADMINS_ONLY"}
              data-ui="OidcSettingsForm.ssoOnly"
            />
            <span>
              シングルサインオンのみ
              <span className={styles.note} style={{ display: "block" }}>
                IdP
                に障害があっても締め出されないよう、サイト管理者だけはパスワードでもログインできます。
              </span>
            </span>
          </label>
        </fieldset>
      </div>

      {test.message && enabled && (
        <p
          className={test.error ? styles.error : styles.success}
          data-ui="OidcSettingsForm.testResult"
        >
          {test.message}
        </p>
      )}
      <p
        data-ui="OidcSettingsForm.status"
        aria-live="polite"
        className={state.error ? styles.error : styles.success}
      >
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonSecondary}
          style={enabled ? undefined : { display: "none" }}
          disabled={testing}
          onClick={() => submit(testAction)}
          data-ui="OidcSettingsForm.testButton"
        >
          {testing ? "確認しています…" : "接続テスト"}
        </button>
        <button
          type="submit"
          className={styles.button}
          disabled={saving}
          data-ui="OidcSettingsForm.submitButton"
        >
          {saving ? "保存しています…" : "保存"}
        </button>
      </div>
    </form>
  );
}
