import { prisma } from "@/lib/db";

// Every way into an account other than its password, as one list of writes to
// run in a transaction: sessions (app and /admin), passkeys, API keys, the AI
// apps connected through OAuth (their tokens go with the grant), and the
// links and codes still waiting to be used. Kept in one place so that a new
// kind of credential is revoked everywhere an account is taken back.
// Open collab connections aren't in the database: call disconnectUsers() too.
export function revokeWaysIn(userId: string) {
  return [
    prisma.userSession.deleteMany({ where: { userId } }),
    prisma.adminSession.deleteMany({ where: { userId } }),
    prisma.userPasskey.deleteMany({ where: { userId } }),
    prisma.apiKey.deleteMany({ where: { userId } }),
    prisma.oAuthGrant.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.emailChangeRequest.deleteMany({ where: { userId } }),
    prisma.emailCode.deleteMany({ where: { userId } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
  ];
}
