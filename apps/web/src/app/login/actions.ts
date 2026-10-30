"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { verifyPassword, verifyPasswordAgainstDummy } from "shared";
import { prisma } from "@/lib/db";
import { emailWhere } from "@/lib/emails";
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import {
  LOCK_WINDOW_MS,
  createUserSession,
  isIpLoginLocked,
  isLoginLocked,
  normalizeEmail,
  recordLoginAttempt,
  safeNextPath,
} from "@/lib/auth/session";
import { getRequestContext } from "@/lib/request";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import { beginAuthentication, finishAuthentication, passwordLoginBlockedByPasskey } from "@/lib/auth/passkeys";

export type LoginState = { error?: string; email?: string };

// auth: public — the login itself.
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ctx = await getRequestContext();
  const t = await getTranslations();
  const rawEmail = formData.get("email");
  const password = formData.get("password");
  if (typeof rawEmail !== "string" || typeof password !== "string" || !rawEmail || !password) {
    return { error: t("login.errors.missing") };
  }
  const email = normalizeEmail(rawEmail);

  // Check the lock before the (deliberately slow) password check.
  if (await isLoginLocked(ctx.ip, email)) {
    return { error: t("login.errors.locked", { minutes: LOCK_WINDOW_MS / 60000 }), email };
  }

  const user = await prisma.user.findUnique({
    where: await emailWhere(email),
    select: { id: true, passwordHash: true, disabledAt: true, siteRole: true },
  });
  // Same cost whether or not the account exists, so emails can't be probed.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPasswordAgainstDummy(password);

  // The site requires passkeys and this account has one: the password alone
  // doesn't sign in. Counted as a failure, so the answer (which tells that
  // the password was right) can't be used to try passwords endlessly.
  const passkeyOnly = ok && user ? await passwordLoginBlockedByPasskey(user.id) : false;
  await recordLoginAttempt(ctx, email, ok && !passkeyOnly);
  if (!ok || !user) {
    return { error: t("login.errors.wrong"), email };
  }
  // Only revealed after the correct password, so it can't be used to probe.
  if (user.disabledAt) {
    return { error: t("common.errors.disabledAccount"), email };
  }
  // SSO-only sites: passwords still work for site admins (a way back in if
  // the IdP fails). Also only told after the correct password.
  if (!(await passwordLoginAllowed(user.siteRole))) {
    return { error: t("common.errors.ssoOnly"), email };
  }

  if (passkeyOnly) {
    return { error: t("login.errors.usePasskey"), email };
  }

  await createUserSession(ctx, user.id, "PASSWORD");
  redirect(safeNextPath(formData.get("next")));
}

// ---- Passkeys ----------------------------------------------------------------
// Two steps around the browser's passkey prompt: the options (with the
// challenge, kept in a cookie), then the signed answer.

// auth: public — the passkey login itself.
export async function beginPasskeyLogin(): Promise<
  { options: PublicKeyCredentialRequestOptionsJSON } | { error: string }
> {
  const ctx = await getRequestContext();
  const t = await getTranslations();
  if (await isIpLoginLocked(ctx.ip)) {
    return { error: t("login.errors.locked", { minutes: LOCK_WINDOW_MS / 60000 }) };
  }
  return { options: await beginAuthentication() };
}

// auth: public — the passkey login itself.
export async function finishPasskeyLogin(response: AuthenticationResponseJSON, next: string): Promise<{ error: string }> {
  const ctx = await getRequestContext();
  const t = await getTranslations();
  if (await isIpLoginLocked(ctx.ip)) {
    return { error: t("login.errors.locked", { minutes: LOCK_WINDOW_MS / 60000 }) };
  }
  const result = await finishAuthentication(response);
  if ("error" in result) {
    // Counted for the IP only: a passkey sign-in has no address.
    await prisma.userLoginAttempt.create({ data: { ip: ctx.ip, success: false, userAgent: ctx.userAgent } });
    return { error: result.error === "expired" ? t("login.errors.passkeyExpired") : t("login.errors.passkeyFailed") };
  }
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: result.userId },
    select: { id: true, emailHash: true, disabledAt: true, siteRole: true },
  });
  await prisma.userLoginAttempt.create({
    data: { ip: ctx.ip, emailHash: user.emailHash, success: true, userAgent: ctx.userAgent },
  });
  if (user.disabledAt) {
    return { error: t("common.errors.disabledAccount") };
  }
  // A passkey signs in on this site's own, like a password: SSO-only sites
  // keep it for site admins only.
  if (!(await passwordLoginAllowed(user.siteRole))) {
    return { error: t("common.errors.ssoOnly") };
  }

  await createUserSession(ctx, user.id, "PASSKEY");
  redirect(safeNextPath(next));
}
