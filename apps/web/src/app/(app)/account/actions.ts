"use server";

import { ownPasswordResetAvailability } from "@/lib/auth/own-password-reset";
import {
  PASSWORD_RESET_TTL_MINUTES,
  createPasswordReset,
  isPasswordResetRateLimited,
} from "@/lib/auth/password-reset";
import { requireUser } from "@/lib/auth/session";
import { sendMail } from "@/lib/mail";
import { passwordResetMail } from "@/lib/mail-templates";
import { getRequestContext } from "@/lib/request";
import { getPublicUrl } from "@/lib/site-url";

export type OwnPasswordResetState = { error?: string; sentTo?: string };

// Mails the signed-in user a link to set a new password (the same link and
// screen as "forgot password"). Their password isn't asked for or changed
// here: the mailbox is the proof, as it is when signed out.
export async function requestOwnPasswordReset(): Promise<OwnPasswordResetState> {
  const user = await requireUser("/account");
  const availability = await ownPasswordResetAvailability(user.id);
  if (!availability.available) {
    return {
      error:
        availability.reason === "mail"
          ? "メール送信が設定されていないため、再設定のメールを送れません。管理者に連絡してください。"
          : "シングルサインオンでログインするアカウントのため、パスワードは再設定できません。",
    };
  }
  const { ip } = await getRequestContext();
  if (await isPasswordResetRateLimited(user.id, ip)) {
    return { error: "再設定のメールを続けて送りすぎています。しばらく待ってからお試しください。" };
  }
  const token = await createPasswordReset(user.id, { byAdmin: false, ip });
  const link = `${await getPublicUrl()}/reset-password/${token}`;
  try {
    // Waited for, unlike "forgot password": the person is known, so there is
    // nothing to hide, and they should hear if the mail couldn't be sent.
    await sendMail({
      to: user.email,
      ...passwordResetMail({ link, ttl: `${PASSWORD_RESET_TTL_MINUTES}分間`, byAdmin: false }),
    });
  } catch (err) {
    console.error("[account] sending the password reset mail failed", err);
    return { error: "メールを送信できませんでした。時間をおいて再度お試しいただくか、管理者に連絡してください。" };
  }
  return { sentTo: user.email };
}
