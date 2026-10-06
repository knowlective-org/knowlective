import { createHash, randomBytes } from "node:crypto";
import { createKnowledgeRoot, type MemberRole, type Prisma, type SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { rootNameSelect } from "@/lib/knowledge-roots";

// Invitation links: /invite/<token>. Only the SHA-256 hash of the token is
// stored, so the link can't be recovered from the database — it is shown to
// the admin exactly once when issued.

export const INVITATION_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type NewInvitation = (
  | { kind: "existing"; rootId: string; role: MemberRole }
  | { kind: "new"; rootName: string }
) & { email?: string; siteRole: SiteRole };

export async function createInvitation(input: NewInvitation): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      tokenHash: hashToken(token),
      email: input.email || null,
      // Whoever creates a new knowledge root owns it.
      role: input.kind === "new" ? "OWNER" : input.role,
      rootId: input.kind === "existing" ? input.rootId : null,
      newRootName: input.kind === "new" ? input.rootName : null,
      // Applied when the invitation creates a new account.
      siteRole: input.siteRole,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function findValidInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { root: { select: { id: true, ...rootNameSelect } } },
  });
  if (!invitation || invitation.usedAt || invitation.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return invitation;
}

export class InvitationUnavailableError extends Error {
  constructor() {
    super("Invitation is used, expired, or revoked");
  }
}

// Marks the invitation used and grants the membership, inside the caller's
// transaction. The conditional update makes each link single-use even under
// concurrent requests.
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

  const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: invitationId } });
  let rootId = invitation.rootId;
  if (!rootId) {
    ({ rootId } = await createKnowledgeRoot(tx, {
      title: invitation.newRootName ?? "ナレッジルート",
      createdById: userId,
    }));
  }

  // Already a member: keep the existing role rather than silently changing it.
  await tx.knowledgeRootMember.upsert({
    where: { userId_rootId: { userId, rootId } },
    create: { userId, rootId, role: invitation.role },
    update: {},
  });
}

export async function listPendingInvitations() {
  return prisma.invitation.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { root: { select: rootNameSelect } },
  });
}
