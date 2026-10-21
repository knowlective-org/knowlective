import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { decrypt, encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { getRequestContext, getRequestOrigin } from "@/lib/request";
import { COOKIE_PATH, type CurrentUser, passkeyRequiredSetting } from "./session";

// Passkeys (WebAuthn), signed in with instead of a password. The protocol
// checks — challenge, origin, relying party, signature, user verification,
// counter — are done by @simplewebauthn/server; this module keeps the
// challenge between the two steps and the credentials in UserPasskey.
//
// Policy (InstanceConfig.passkeyRequired): off, passkeys are optional and the
// password keeps working. On, an account with a passkey can only sign in with
// it, and one without (signed in with its password) must register one first
// (lib/auth/session.ts). Single sign-on sessions are exempt either way.
//
// Both ceremonies ask for user verification (fingerprint, face, PIN): a
// passkey replaces the password, so having the device alone isn't enough.

const RP_NAME = "KNOWLECTIVE";
const CHALLENGE_COOKIE = "knowlective_passkey";
const CHALLENGE_AAD = "knowlective:passkey-challenge";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_PASSKEY_NAME_LENGTH = 60;

export function passkeyNameAad(id: string): string {
  return `knowlective:passkey-name:${id}`;
}

// The relying party is the host the browser is on: a passkey only works at
// the address it was registered at (the browser enforces this), so one
// registered at the public URL doesn't sign in at an internal address, and a
// site moved to another host needs its passkeys registered again.
// Taking it from the request (not the public URL setting) is safe here, unlike
// for links: the browser signs the origin it's actually on, so a forged Host
// header only makes the server expect an origin no genuine answer has.
async function relyingParty(): Promise<{ id: string; origin: string }> {
  const url = new URL(await getRequestOrigin());
  return { id: url.hostname, origin: url.origin };
}

// ---- Challenge cookie --------------------------------------------------------
// The challenge of the ceremony in progress, encrypted (it must not be
// replaced by the browser), bound to its purpose and, for registration, to
// the user. Single use: taken (and deleted) by the second step.

type Challenge = { challenge: string; purpose: "register" | "login"; userId: string | null; exp: number };

async function putChallenge(challenge: Omit<Challenge, "exp">): Promise<void> {
  const sealed = encrypt(
    await loadDataKey(prisma),
    Buffer.from(JSON.stringify({ ...challenge, exp: Date.now() + CHALLENGE_TTL_MS }), "utf8"),
    CHALLENGE_AAD,
  );
  (await cookies()).set(CHALLENGE_COOKIE, Buffer.from(sealed).toString("base64url"), {
    httpOnly: true,
    secure: (await getRequestContext()).secure,
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

async function takeChallenge(purpose: Challenge["purpose"], userId: string | null): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(CHALLENGE_COOKIE)?.value;
  store.delete({ name: CHALLENGE_COOKIE, path: COOKIE_PATH });
  if (!raw) return null;
  try {
    const c = JSON.parse(
      decrypt(await loadDataKey(prisma), Buffer.from(raw, "base64url"), CHALLENGE_AAD).toString("utf8"),
    ) as Challenge;
    return c.exp > Date.now() && c.purpose === purpose && c.userId === userId ? c.challenge : null;
  } catch {
    return null;
  }
}

// ---- Registration ------------------------------------------------------------

export async function beginRegistration(user: CurrentUser): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const rp = await relyingParty();
  const existing = await prisma.userPasskey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    // Shown by the authenticator when choosing a passkey.
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    // The same authenticator twice would only be a second row for one key.
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    // Discoverable: sign-in asks for no address first.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await putChallenge({ challenge: options.challenge, purpose: "register", userId: user.id });
  return options;
}

export type RegistrationError = "expired" | "invalid";

export async function finishRegistration(
  user: CurrentUser,
  response: RegistrationResponseJSON,
  name: string,
): Promise<{ id: string } | { error: RegistrationError }> {
  const expectedChallenge = await takeChallenge("register", user.id);
  if (!expectedChallenge) return { error: "expired" };
  const rp = await relyingParty();
  let info;
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
    if (!result.verified) return { error: "invalid" };
    info = result.registrationInfo;
  } catch (err) {
    console.error("[passkeys] registration not verified", err);
    return { error: "invalid" };
  }
  const { credential } = info;
  if (await prisma.userPasskey.findUnique({ where: { credentialId: credential.id }, select: { id: true } })) {
    return { error: "invalid" };
  }
  const id = randomUUID();
  await prisma.userPasskey.create({
    data: {
      id,
      userId: user.id,
      credentialId: credential.id,
      publicKey: Uint8Array.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports ?? [],
      nameEnc: Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(name, "utf8"), passkeyNameAad(id))),
    },
  });
  return { id };
}

// ---- Sign-in -----------------------------------------------------------------

export async function beginAuthentication(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const rp = await relyingParty();
  // No allowCredentials: the browser offers the passkeys it has for this site.
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "required" });
  await putChallenge({ challenge: options.challenge, purpose: "login", userId: null });
  return options;
}

// The user the passkey belongs to, once its signature checks out. Whether
// they may sign in (disabled, …) is for the caller.
export async function finishAuthentication(
  response: AuthenticationResponseJSON,
): Promise<{ userId: string } | { error: "expired" | "invalid" }> {
  const expectedChallenge = await takeChallenge("login", null);
  if (!expectedChallenge) return { error: "expired" };
  const passkey = await prisma.userPasskey.findUnique({ where: { credentialId: response.id } });
  if (!passkey) return { error: "invalid" };
  const rp = await relyingParty();
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: passkey.credentialId,
        publicKey: Uint8Array.from(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
    if (!result.verified) return { error: "invalid" };
    await prisma.userPasskey.update({
      where: { id: passkey.id },
      data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
  } catch (err) {
    console.error("[passkeys] sign-in not verified", err);
    return { error: "invalid" };
  }
  return { userId: passkey.userId };
}

// ---- Listing and policy ------------------------------------------------------

export type PasskeyView = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null };

export async function listPasskeys(userId: string): Promise<PasskeyView[]> {
  const rows = await prisma.userPasskey.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, nameEnc: true, createdAt: true, lastUsedAt: true },
  });
  const key = await loadDataKey(prisma);
  return rows.map((r) => ({
    id: r.id,
    name: decrypt(key, r.nameEnc, passkeyNameAad(r.id)).toString("utf8"),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

// Password sign-in refused: the site requires passkeys and the account has one.
export async function passwordLoginBlockedByPasskey(userId: string): Promise<boolean> {
  if (!(await passkeyRequiredSetting())) return false;
  return (await prisma.userPasskey.count({ where: { userId } })) > 0;
}

export { passkeyRequiredSetting };
