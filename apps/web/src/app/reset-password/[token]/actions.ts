"use server";

import { redirect } from "next/navigation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "shared";
import {
  PasswordResetUnavailableError,
  completePasswordReset,
  findValidPasswordReset,
} from "@/lib/auth/password-reset";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import { recordAudit, userLabel } from "@/lib/audit";

export type ResetPasswordState = { error?: string };

const UNAVAILABLE = "このリンクは使用済みか、期限が切れています。もう一度、再設定をお申し込みください。";

export async function resetPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const token = formData.get("token");
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof token !== "string" || typeof password !== "string" || typeof confirm !== "string") {
    return { error: "入力内容が不正です。" };
  }

  const reset = await findValidPasswordReset(token);
  if (!reset) return { error: UNAVAILABLE };
  // SSO-only sites: a password would be useless (and an unused way in).
  if (!(await passwordLoginAllowed(reset.user.siteRole))) {
    return { error: "パスワードでのログインは無効になっています。シングルサインオンでログインしてください。" };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。` };
  }
  if (password !== confirm) return { error: "確認用のパスワードが一致しません。" };

  try {
    await completePasswordReset(reset.id, reset.user.id, password);
  } catch (err) {
    if (err instanceof PasswordResetUnavailableError) return { error: UNAVAILABLE };
    throw err;
  }
  const who = userLabel(reset.user);
  await recordAudit(
    { userId: reset.user.id, label: who },
    "user.password.reset",
    `${who} がパスワードを再設定（${reset.issuedByAdmin ? "管理者が発行したリンク" : "メールのリンク"}）`,
    { userId: reset.user.id, issuedByAdmin: reset.issuedByAdmin },
  );
  // Log in with the new password rather than automatically: every session
  // was just ended, and the login page applies its own checks.
  redirect("/login?reset=done");
}
