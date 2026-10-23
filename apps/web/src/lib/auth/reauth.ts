import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyPassword } from "shared";
import { prisma } from "@/lib/db";
import { getRequestContext } from "@/lib/request";
import { getOidcSettings, passwordLoginAllowed } from "./oidc";
import { finishReauthentication, passwordLoginBlockedByPasskey } from "./passkeys";
import { type CurrentUser, type SessionInfo, isLoginLocked, recordLoginAttempt } from "./session";

// Confirming that the signed-in person is the account's owner, before
// something a stolen session alone shouldn't allow (issuing an API key). The
// ways depend on the account:
// - passkey: one of the account's passkeys (offered when it has any);
// - password: for accounts that sign in with one (not SSO-linked accounts,
//   whose password, if any, was never chosen by them; not where SSO-only or
//   required passkeys make the password unusable for signing in);
// - single sign-on: a session signed in with SSO in the last few minutes
//   counts as confirmed (the identity provider just checked); otherwise the
//   person signs in with SSO again.

export const SSO_REAUTH_WINDOW_MS = 10 * 60 * 1000;

export type ReauthMethods = {
  passkey: boolean;
  password: boolean;
  // "fresh": this session is a recent SSO sign-in (confirmed already);
  // "again": signing in with SSO again would confirm; null: not available.
  sso: "fresh" | "again" | null;
};

export async function reauthMethods(user: CurrentUser, session: SessionInfo): Promise<ReauthMethods> {
  const [account, passkeys, oidc, passwordBlocked, passwordAllowed] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { oidcSubject: true } }),
    prisma.userPasskey.count({ where: { userId: user.id } }),
    getOidcSettings(),
    passwordLoginBlockedByPasskey(user.id),
    passwordLoginAllowed(user.siteRole),
  ]);
  const ssoLinked = account.oidcSubject !== null;
  const fresh = session.method === "OIDC" && Date.now() - session.createdAt.getTime() < SSO_REAUTH_WINDOW_MS;
  return {
    passkey: passkeys > 0,
    password: !ssoLinked && passwordAllowed && !passwordBlocked,
    sso: fresh ? "fresh" : ssoLinked && oidc.enabled ? "again" : null,
  };
}

export type ReauthProof = { password?: string; passkey?: AuthenticationResponseJSON };

// Whether `proof` confirms the user, by a way their account has. Wrong
// passwords count towards the sign-in lockout, as on the login screen.
export async function verifyReauth(
  user: CurrentUser,
  session: SessionInfo,
  proof: ReauthProof,
): Promise<"ok" | "failed" | "locked"> {
  const methods = await reauthMethods(user, session);
  if (proof.passkey && methods.passkey) {
    return (await finishReauthentication(user, proof.passkey)) ? "ok" : "failed";
  }
  if (typeof proof.password === "string" && methods.password) {
    const ctx = await getRequestContext();
    if (await isLoginLocked(ctx.ip, user.email)) return "locked";
    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    const ok = await verifyPassword(proof.password, account.passwordHash);
    if (!ok) await recordLoginAttempt(ctx, user.email, false);
    return ok ? "ok" : "failed";
  }
  return methods.sso === "fresh" ? "ok" : "failed";
}
