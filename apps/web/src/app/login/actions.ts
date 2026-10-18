"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { verifyPassword, verifyPasswordAgainstDummy } from "shared";
import { prisma } from "@/lib/db";
import { emailWhere } from "@/lib/emails";
import {
  LOCK_WINDOW_MS,
  createUserSession,
  isLoginLocked,
  normalizeEmail,
  recordLoginAttempt,
  safeNextPath,
} from "@/lib/auth/session";
import { getRequestContext } from "@/lib/request";
import { passwordLoginAllowed } from "@/lib/auth/oidc";

export type LoginState = { error?: string; email?: string };

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

  await recordLoginAttempt(ctx, email, ok);
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

  await createUserSession(ctx, user.id);
  redirect(safeNextPath(formData.get("next")));
}
