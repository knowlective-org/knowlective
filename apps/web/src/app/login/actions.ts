"use server";

import { redirect } from "next/navigation";
import { verifyPassword, verifyPasswordAgainstDummy } from "shared";
import { prisma } from "@/lib/db";
import {
  LOCK_WINDOW_MS,
  createUserSession,
  isLoginLocked,
  normalizeEmail,
  recordLoginAttempt,
  safeNextPath,
} from "@/lib/auth/session";
import { getRequestContext } from "@/lib/request";

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ctx = await getRequestContext();
  const rawEmail = formData.get("email");
  const password = formData.get("password");
  if (typeof rawEmail !== "string" || typeof password !== "string" || !rawEmail || !password) {
    return { error: "メールアドレスとパスワードを入力してください。" };
  }
  const email = normalizeEmail(rawEmail);

  // Check the lock before the (deliberately slow) password check.
  if (await isLoginLocked(ctx.ip, email)) {
    return {
      error: `ログインの失敗が続いたため、一時的にロックしています。${
        LOCK_WINDOW_MS / 60000
      }分ほど待ってから再度お試しください。`,
      email,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, disabledAt: true },
  });
  // Same cost whether or not the account exists, so emails can't be probed.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPasswordAgainstDummy(password);

  await recordLoginAttempt(ctx, email, ok);
  if (!ok || !user) {
    return { error: "メールアドレスまたはパスワードが正しくありません。", email };
  }
  // Only revealed after the correct password, so it can't be used to probe.
  if (user.disabledAt) {
    return { error: "このアカウントは無効になっています。管理者に問い合わせてください。", email };
  }

  await createUserSession(ctx, user.id);
  redirect(safeNextPath(formData.get("next")));
}
