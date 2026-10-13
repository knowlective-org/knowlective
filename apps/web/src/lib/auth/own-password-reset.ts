import { prisma } from "@/lib/db";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import { isMailConfigured } from "@/lib/mail";

// Whether a signed-in user can reset their own password from the account
// screen (a reset link mailed to their own address), and if not, why.
//
// Not possible:
// - without mail: the link has nowhere to go (an administrator can issue one
//   from /admin instead);
// - for an account that signs in through single sign-on: its password, if it
//   has one at all, isn't what it signs in with.
export type OwnPasswordResetAvailability =
  | { available: true }
  | { available: false; reason: "mail" | "sso" };

export async function ownPasswordResetAvailability(userId: string): Promise<OwnPasswordResetAvailability> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { siteRole: true, oidcSubject: true },
  });
  if (user.oidcSubject !== null || !(await passwordLoginAllowed(user.siteRole))) {
    return { available: false, reason: "sso" };
  }
  if (!(await isMailConfigured())) return { available: false, reason: "mail" };
  return { available: true };
}
