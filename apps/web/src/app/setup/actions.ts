"use server";

import { redirect } from "next/navigation";
import {
  InstanceAlreadySetUpError,
  InvalidPublicUrlError,
  MIN_MASTER_PASSWORD_LENGTH,
  normalizePublicUrl,
  setupInstance,
} from "shared";
import { prisma } from "@/lib/db";

export type SetupState = { error?: string };

export async function completeSetup(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  const publicUrl = formData.get("publicUrl");

  if (typeof password !== "string" || typeof confirm !== "string" || typeof publicUrl !== "string") {
    return { error: "入力内容が不正です。" };
  }
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    return { error: `マスターパスワードは${MIN_MASTER_PASSWORD_LENGTH}文字以上にしてください。` };
  }
  if (password !== confirm) {
    return { error: "確認用のパスワードが一致しません。" };
  }
  try {
    normalizePublicUrl(publicUrl);
  } catch (err) {
    if (err instanceof InvalidPublicUrlError) return { error: err.message };
    throw err;
  }

  try {
    await setupInstance(prisma, password, publicUrl);
  } catch (err) {
    // Someone else finished setup first. Never overwrite an existing key.
    if (err instanceof InstanceAlreadySetUpError) redirect("/");
    console.error("[setup] failed", err);
    return {
      error:
        "セットアップに失敗しました。サーバーの KNOWLECTIVE_SERVER_KEY が設定されているか確認してください。",
    };
  }

  // Continue straight to the first admin login, which enrolls 2FA.
  redirect("/admin/login");
}
