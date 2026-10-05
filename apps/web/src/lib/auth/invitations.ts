import { createHash, randomBytes } from "node:crypto";
import type { MemberRole, Prisma } from "shared";
import { prisma } from "@/lib/db";

// Invitation links: /invite/<token>. Only the SHA-256 hash of the token is
// stored, so the link can't be recovered from the database — it is shown to
// the admin exactly once when issued.

export const INVITATION_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type NewInvitation =
  | { kind: "existing"; workspaceId: string; role: MemberRole; email?: string }
  | { kind: "new"; workspaceName: string; email?: string };

export async function createInvitation(input: NewInvitation): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      tokenHash: hashToken(token),
      email: input.email || null,
      // Whoever creates a new workspace owns it.
      role: input.kind === "new" ? "OWNER" : input.role,
      workspaceId: input.kind === "existing" ? input.workspaceId : null,
      newWorkspaceName: input.kind === "new" ? input.workspaceName : null,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function findValidInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: { select: { id: true, name: true } } },
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
  let workspaceId = invitation.workspaceId;
  if (!workspaceId) {
    const workspace = await tx.workspace.create({
      data: {
        name: invitation.newWorkspaceName ?? "ワークスペース",
        slug: randomBytes(6).toString("base64url").toLowerCase(),
      },
    });
    workspaceId = workspace.id;
  }

  // Already a member: keep the existing role rather than silently changing it.
  await tx.workspaceMember.upsert({
    where: { userId_workspaceId: { userId, workspaceId } },
    create: { userId, workspaceId, role: invitation.role },
    update: {},
  });
}

export async function listPendingInvitations() {
  return prisma.invitation.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { workspace: { select: { name: true } } },
  });
}
