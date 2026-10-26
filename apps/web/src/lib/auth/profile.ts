import { prisma } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail";
import { getOidcSettings } from "./oidc";

// What a signed-in user may change about themselves on the account screen.
// Name: anyone, except accounts linked to single sign-on unless the admin
// console allows it (the identity provider's name is kept otherwise) and the
// name isn't set again at every sign-in (it would only be overwritten). Email
// address: anyone, when mail sending is set up (the new address is confirmed
// by a mailed link).

export const MAX_NAME_LENGTH = 100;

export type ProfileRules = { name: "allowed" | "sso"; email: "allowed" | "mail" };

export async function profileRules(userId: string): Promise<ProfileRules> {
  const [user, oidc, mail] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { oidcSubject: true } }),
    getOidcSettings(),
    isMailConfigured(),
  ]);
  return {
    name: user.oidcSubject === null || (oidc.allowNameChange && !oidc.syncName) ? "allowed" : "sso",
    email: mail ? "allowed" : "mail",
  };
}
