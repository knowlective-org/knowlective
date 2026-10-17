"use client";

import { useActionState } from "react";
import { completeSetup, type SetupState } from "./actions";

const initialState: SetupState = {};

const fieldStyle = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: 4,
  fontSize: 16,
  border: "1px solid #999",
  borderRadius: 6,
} as const;

export function SetupForm({ minLength, suggestedUrl }: { minLength: number; suggestedUrl: string }) {
  const [state, formAction, pending] = useActionState(completeSetup, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: 16 }} data-ui="SetupForm">
      <label>
        サイトの公開 URL
        <input
          data-ui="SetupForm.publicUrlInput"
          type="url"
          name="publicUrl"
          required
          defaultValue={suggestedUrl}
          placeholder="https://knowlective.example.com"
          spellCheck={false}
          style={fieldStyle}
        />
        <span style={{ display: "block", fontSize: 14, opacity: 0.75, marginTop: 4 }}>
          メールや招待リンクに使われます。利用者がブラウザで開く URL を入力してください。あとから管理画面で変更できます。
        </span>
      </label>
      <label>
        マスターパスワード（{minLength}文字以上）
        <input
          data-ui="SetupForm.passwordInput"
          type="password"
          name="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          style={fieldStyle}
        />
      </label>
      <label>
        マスターパスワード（確認）
        <input
          data-ui="SetupForm.confirmPasswordInput"
          type="password"
          name="confirm"
          required
          minLength={minLength}
          autoComplete="new-password"
          style={fieldStyle}
        />
      </label>
      <p aria-live="polite" style={{ color: "#d33", minHeight: "1.5em" }} data-ui="SetupForm.error">
        {state.error}
      </p>
      <button
        data-ui="SetupForm.submitButton"
        type="submit"
        disabled={pending}
        style={{ padding: "10px 16px", fontSize: 16, borderRadius: 6, cursor: "pointer" }}
      >
        {pending ? "鍵を生成しています…" : "セットアップを完了する"}
      </button>
    </form>
  );
}
