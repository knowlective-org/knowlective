import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "shared";
import { prisma } from "@/lib/db";
import { withEmail } from "@/lib/emails";

// Password reset links: /reset-password/<token>. Same token scheme as
// invitations (only the SHA-256 hash is stored, single use).
//
// Two ways to get one:
// - /forgot-password mails it to the account's address (needs mail settings).
//   The form answers the same whether or not the address has an account.
// - A site admin issues it in /admin/users and hands it over (or mails it).
//   This is the way back in when mail isn't configured.
//
// Resetting ends every session of the account, normal and /admin.

export const PASSWORD_RESET_TTL_MINUTES = 60;
export const ADMIN_PASSWORD_RESET_TTL_HOURS = 24;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 5;
const MAX_REQUESTS_PER_USER = 3;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Whether /forgot-password may mail this user another link right now. Only
// requests for existing accounts are stored, so the caller must not tell
// the requester when this is true (that would reveal the account exists).
export async function isPasswordResetRateLimited(userId: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const [byIp, byUser] = await Promise.all([
    prisma.passwordResetToken.count({ where: { requestedIp: ip, createdAt: { gt: since } } }),
    prisma.passwordResetToken.count({ where: { userId, issuedByAdmin: false, createdAt: { gt: since } } }),
  ]);
  return byIp >= MAX_REQUESTS_PER_IP || byUser >= MAX_REQUESTS_PER_USER;
}

// Issues a new link and expires any earlier unused ones for the same user,
// so only the latest link works.
export async function createPasswordReset(
  userId: string,
  source: { byAdmin: true } | { byAdmin: false; ip: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const ttlMs = source.byAdmin
    ? ADMIN_PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000
    : PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        issuedByAdmin: source.byAdmin,
        requestedIp: source.byAdmin ? null : source.ip,
        expiresAt: new Date(now.getTime() + ttlMs),
      },
    }),
  ]);
  return token;
}

// The link's account, or null if the link is used, expired, superseded, or
// the account has been disabled since.
export async function findValidPasswordReset(token: string) {
  const reset = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, emailEnc: true, name: true, siteRole: true, disabledAt: true } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now() || reset.user.disabledAt) {
    return null;
  }
  return { ...reset, user: await withEmail(reset.user) };
}

export class PasswordResetUnavailableError extends Error {
  constructor() {
    super("Password reset link is used, expired, or superseded");
  }
}

// Sets the new password and ends all of the account's sessions. The
// conditional update makes the link single-use under concurrent requests.
export async function completePasswordReset(resetId: string, userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: resetId, userId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) throw new PasswordResetUnavailableError();
    const updated = await tx.user.updateMany({
      where: { id: userId, disabledAt: null },
      data: { passwordHash },
    });
    if (updated.count !== 1) throw new PasswordResetUnavailableError();
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    await tx.userSession.deleteMany({ where: { userId } });
    await tx.adminSession.deleteMany({ where: { userId } });
  });
}
