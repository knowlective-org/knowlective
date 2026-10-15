"use server";

import { prisma } from "@/lib/db";
import { emailWhere } from "@/lib/emails";
import { normalizeEmail } from "@/lib/auth/session";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import {
  PASSWORD_RESET_TTL_MINUTES,
  createPasswordReset,
  isPasswordResetRateLimited,
} from "@/lib/auth/password-reset";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { passwordResetMail } from "@/lib/mail-templates";
import { getRequestContext } from "@/lib/request";
import { getPublicUrl } from "@/lib/site-url";

export type ForgotPasswordState = { error?: string; sentTo?: string };

// Mails a reset link if the address belongs to an enabled account that may
// sign in with a password. The answer is the same in every case (and the
// mail is sent in the background so timing doesn't differ either), so the
// form can't be used to find out who has an account.
export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  if (!(await isMailConfigured())) {
    return { error: "メール送信が設定されていないため、再設定のメールを送れません。管理者に連絡してください。" };
  }
  const raw = formData.get("email");
  if (typeof raw !== "string") return { error: "入力内容が不正です。" };
  const email = normalizeEmail(raw);
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
    return { error: "メールアドレスの形式が正しくありません。" };
  }

  const { ip } = await getRequestContext();
  const user = await prisma.user.findUnique({
    where: await emailWhere(email),
    select: { id: true, disabledAt: true, siteRole: true },
  });
  if (
    user &&
    !user.disabledAt &&
    (await passwordLoginAllowed(user.siteRole)) &&
    !(await isPasswordResetRateLimited(user.id, ip))
  ) {
    const token = await createPasswordReset(user.id, { byAdmin: false, ip });
    const link = `${await getPublicUrl()}/reset-password/${token}`;
    void sendMail({
      to: email,
      ...passwordResetMail({ link, ttl: `${PASSWORD_RESET_TTL_MINUTES}分間`, byAdmin: false }),
    }).catch((err) => console.error("[forgot-password] sending the mail failed", err));
  }
  return { sentTo: email };
}
