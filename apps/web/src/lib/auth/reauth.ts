import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail";
import { type EmailCodePurpose, checkEmailCode } from "./email-code";
import { finishReauthentication } from "./passkeys";
import type { CurrentUser } from "./session";

// Confirming that the signed-in person is the account's owner, before
// something a stolen session alone shouldn't allow (issuing an API key). One
// way per account, fixed:
// - an account with a passkey confirms with one of its passkeys;
// - one without gets a code mailed to its address (lib/auth/email-code.ts);
//   without mail sending set up, it can't confirm (and registers a passkey
//   first).

export type ReauthMethod = "passkey" | "code" | null;

export async function reauthMethod(userId: string): Promise<ReauthMethod> {
  if ((await prisma.userPasskey.count({ where: { userId } })) > 0) return "passkey";
  return (await isMailConfigured()) ? "code" : null;
}

export type ReauthProof = { passkey?: AuthenticationResponseJSON; code?: string };

export async function verifyReauth(user: CurrentUser, purpose: EmailCodePurpose, proof: ReauthProof): Promise<boolean> {
  const method = await reauthMethod(user.id);
  if (method === "passkey") return proof.passkey ? finishReauthentication(user, proof.passkey) : false;
  if (method === "code") return typeof proof.code === "string" ? checkEmailCode(user.id, purpose, proof.code) : false;
  return false;
}
