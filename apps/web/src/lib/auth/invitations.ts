import { createHash, randomBytes } from "node:crypto";
import type { Prisma, SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { emailColumns, openOptionalEmail } from "@/lib/emails";

// Invitation links: /invite/<token>. Only the SHA-256 hash of the token is
// stored, so the link can't be recovered from the database — it is shown to
// the admin exactly once when issued.
//
// An invitation carries the site role for a new account and the groups to
// join. Page access comes only from those groups' grants.

export const INVITATION_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type NewInvitation = { email?: string; siteRole: SiteRole; groupIds: string[] };

export async function createInvitation(input: NewInvitation): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      tokenHash: hashToken(token),
      ...(input.email ? await emailColumns(input.email) : {}),
      // Applied when the invitation creates a new account.
      siteRole: input.siteRole,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      groups: { create: input.groupIds.map((groupId) => ({ groupId })) },
    },
  });
  return token;
}

const groupsInclude = { groups: { include: { group: { select: { id: true, name: true } } } } } as const;

export async function findValidInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: groupsInclude,
  });
  if (!invitation || invitation.usedAt || invitation.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return withInvitationEmail(invitation);
}

export class InvitationUnavailableError extends Error {
  constructor() {
    super("Invitation is used, expired, or revoked");
  }
}

// Marks the invitation used and adds the user to its groups, inside the
// caller's transaction. The conditional update makes each link single-use
// even under concurrent requests.
export async function consumeInvitation(
  tx: Prisma.TransactionClient,
  invitationId: string,
  userId: string,
): Promise<void> {
  const { count } = await tx.invitation.updateMany({
    where: { id: invitationId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date(), usedById: userId },
  });
  if (count !== 1) throw new InvitationUnavailableError();

  const groups = await tx.invitationGroup.findMany({ where: { invitationId }, select: { groupId: true } });
  for (const { groupId } of groups) {
    await tx.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId },
      update: {},
    });
  }
}

export async function listPendingInvitations() {
  const invitations = await prisma.invitation.findMany({
    // Self-signup links (lib/auth/signup.ts) aren't the admin's to manage.
    where: { usedAt: null, expiresAt: { gt: new Date() }, selfSignup: false },
    orderBy: { createdAt: "desc" },
    include: groupsInclude,
  });
  return Promise.all(invitations.map(withInvitationEmail));
}

// The address the invitation is bound to, opened (null = anyone).
async function withInvitationEmail<T extends { emailEnc: Uint8Array | null }>(
  invitation: T,
): Promise<Omit<T, "emailEnc" | "emailHash"> & { email: string | null }> {
  const { emailEnc, emailHash: _hash, ...rest } = invitation as T & { emailHash?: unknown };
  return { ...rest, email: await openOptionalEmail(emailEnc) };
}
