"use server";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/session";
import {
  SIGNUP_TTL_HOURS,
  createSignupInvitation,
  getSignupSettings,
  isDomainAllowed,
  isSignupRateLimited,
} from "@/lib/auth/signup";
import { sendMail } from "@/lib/mail";
import { alreadyRegisteredMail, signupMail } from "@/lib/mail-templates";
import { getRequestContext } from "@/lib/request";
import { getPublicUrl } from "@/lib/site-url";

export type SignupState = { error?: string; sentTo?: string };

// Mails a registration link (or, for a registered address, a note to log
// in). The answer is the same either way, so the form can't be used to find
// out who has an account.
export async function requestSignup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const settings = await getSignupSettings();
  if (!settings.enabled) return { error: "現在、アカウント登録は受け付けていません。" };
  const raw = formData.get("email");
  if (typeof raw !== "string") return { error: "入力内容が不正です。" };
  const email = normalizeEmail(raw);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { error: "メールアドレスの形式が正しくありません。" };
  }
  if (!isDomainAllowed(email, settings.allowedDomains)) {
    return { error: `登録できるのは、次のドメインのメールアドレスだけです: ${settings.allowedDomains.join("、")}` };
  }
  const { ip } = await getRequestContext();
  if (await isSignupRateLimited(ip, email)) {
    return { error: "申し込みが多すぎます。しばらく時間をおいてから、もう一度お試しください。" };
  }

  const base = await getPublicUrl();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  // Counted for rate limiting either way (a link for an existing account is never usable).
  const token = await createSignupInvitation(email, ip, settings.siteRole);
  try {
    await sendMail({
      to: email,
      ...(existing
        ? alreadyRegisteredMail({ loginLink: `${base}/login` })
        : signupMail({ link: `${base}/invite/${token}`, ttlHours: SIGNUP_TTL_HOURS })),
    });
  } catch (err) {
    console.error("[signup] sending the mail failed", err);
    return { error: "メールを送信できませんでした。時間をおいてから、もう一度お試しください。" };
  }
  return { sentTo: email };
}
