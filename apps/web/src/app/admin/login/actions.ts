"use server";

import { notFound, redirect } from "next/navigation";
import { verifyMasterPassword, verifyPassword, verifyPasswordAgainstDummy } from "shared";
import { prisma } from "@/lib/db";
import {
  LOCK_WINDOW_MS,
  createAdminSession,
  decryptTotpSecret,
  encryptTotpSecret,
  endAdminSession,
  getAdminConfig,
  getAdminSession,
  getLockState,
  recordLoginAttempt,
} from "@/lib/admin/auth";
import { normalizeEmail } from "@/lib/auth/session";
import { getAdminConsoleRole } from "@/lib/roles";
import { getRequestContext, type RequestContext } from "@/lib/request";
import { isIpAllowed } from "@/lib/ip";
import { generateTotpSecret, verifyTotp } from "@/lib/admin/totp";

export type LoginState = { error?: string; email?: string };

const LOCKED_MESSAGE = `ログインの失敗が続いたため、一時的にロックしています。${
  LOCK_WINDOW_MS / 60000
}分ほど待ってから再度お試しください。`;

// IP allowlist + lockout checks shared by both login forms.
async function precheck(ctx: RequestContext, email?: string): Promise<LoginState | null> {
  const config = await getAdminConfig();
  if (!isIpAllowed(ctx.ip, config.adminIpAllowlist)) {
    await recordLoginAttempt(ctx, false, "ip_denied", email);
    notFound();
  }
  // Check the lock before the (deliberately slow) password check.
  if ((await getLockState(ctx.ip)).locked) {
    await recordLoginAttempt(ctx, false, "locked", email);
    return { error: LOCKED_MESSAGE, email };
  }
  return null;
}

async function failure(ctx: RequestContext, message: string, email?: string): Promise<LoginState> {
  await recordLoginAttempt(ctx, false, "bad_credentials", email);
  const { locked, remaining } = await getLockState(ctx.ip);
  if (locked) return { error: LOCKED_MESSAGE, email };
  return { error: `${message}（あと${remaining}回でロックされます）。`, email };
}

// Normal sign-in: a SITE_ADMIN or CONTENT_MANAGER account, plus TOTP. First
// step: the password. Then either the code (verifyAccountCode) or, for an
// account without an authenticator yet, enrollment.
export async function loginWithAccount(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ctx = await getRequestContext();
  const rawEmail = formData.get("email");
  const password = formData.get("password");
  if (typeof rawEmail !== "string" || typeof password !== "string" || !rawEmail || !password) {
    return { error: "メールアドレスとパスワードを入力してください。" };
  }
  const email = normalizeEmail(rawEmail);
  const blocked = await precheck(ctx, email);
  if (blocked) return blocked;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, totpSecret: true },
  });
  // Same cost whether or not the account exists.
  const passwordOk = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPasswordAgainstDummy(password);
  // Not saying "not an admin" separately: it would confirm the password.
  const allowed = passwordOk && user !== null && (await getAdminConsoleRole(user.id)) !== null;

  if (!allowed) {
    return failure(ctx, "メールアドレスまたはパスワードが正しくないか、管理者権限がありません", email);
  }

  if (user.totpSecret) {
    // Second step: the authenticator code. Not recorded as a success yet —
    // a success resets the failure count, which would give someone who knows
    // the password unlimited guesses at the code.
    await createAdminSession(ctx, "VERIFY_TOTP", { userId: user.id });
    redirect("/admin/login/verify");
  }
  // First admin sign-in for this account: enroll an authenticator app.
  await recordLoginAttempt(ctx, true, undefined, email);
  await createAdminSession(ctx, "ENROLL_TOTP", {
    userId: user.id,
    pendingTotp: await encryptTotpSecret(generateTotpSecret(), user.id),
  });
  redirect("/admin/enroll");
}

// Second step of the account sign-in: the code from the authenticator app.
export async function verifyAccountCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ctx = await getRequestContext();
  const session = await getAdminSession();
  if (!session || session.stage !== "VERIFY_TOTP" || !session.userId || !session.user) {
    redirect("/admin/login");
  }
  const userId = session.userId;
  const email = session.user.email;
  const blocked = await precheck(ctx, email);
  if (blocked) return blocked;

  // Demoted, disabled, or the authenticator was reset since the password step.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpLastStep: true },
  });
  if (!user?.totpSecret || (await getAdminConsoleRole(userId)) === null) {
    await endAdminSession();
    redirect("/admin/login");
  }

  const code = formData.get("code");
  const secret = await decryptTotpSecret(user.totpSecret, userId);
  const step = typeof code === "string" ? verifyTotp(secret, code, user.totpLastStep) : null;
  secret.fill(0);
  let totpOk = false;
  if (step !== null) {
    // Conditional update so two concurrent requests can't both use one code.
    const { count } = await prisma.user.updateMany({
      where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    totpOk = count === 1;
  }
  if (!totpOk) return failure(ctx, "認証コードが正しくありません", email);

  await recordLoginAttempt(ctx, true, undefined, email);
  // Issue a fresh token for the fully authenticated session.
  await endAdminSession();
  await createAdminSession(ctx, "ACTIVE", { userId });
  redirect("/admin");
}

// Leave the code step (e.g. to sign in with another account).
export async function cancelAccountLogin(): Promise<void> {
  await endAdminSession();
  redirect("/admin/login");
}

// Bootstrap / recovery: the master password plus the instance's TOTP.
export async function loginWithMasterPassword(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const ctx = await getRequestContext();
  const blocked = await precheck(ctx);
  if (blocked) return blocked;

  const password = formData.get("password");
  const code = formData.get("code");
  if (typeof password !== "string" || password === "") {
    return { error: "マスターパスワードを入力してください。" };
  }

  const config = await getAdminConfig();
  const passwordOk = await verifyMasterPassword(prisma, password);
  const enrolled = config.totpSecret !== null;
  let totpOk = !enrolled;

  if (passwordOk && enrolled) {
    const secret = await decryptTotpSecret(config.totpSecret!, null);
    const step = typeof code === "string" ? verifyTotp(secret, code, config.totpLastStep) : null;
    secret.fill(0);
    if (step !== null) {
      const { count } = await prisma.instanceConfig.updateMany({
        where: { id: 1, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      totpOk = count === 1;
    }
  }

  if (!passwordOk || !totpOk) {
    // Don't say which factor was wrong.
    return failure(ctx, enrolled ? "マスターパスワードまたは認証コードが正しくありません" : "マスターパスワードが正しくありません");
  }

  await recordLoginAttempt(ctx, true);
  if (enrolled) {
    await createAdminSession(ctx, "ACTIVE");
    redirect("/admin");
  }
  await createAdminSession(ctx, "ENROLL_TOTP", {
    pendingTotp: await encryptTotpSecret(generateTotpSecret(), null),
  });
  redirect("/admin/enroll");
}
