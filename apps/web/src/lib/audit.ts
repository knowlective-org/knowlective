import type { Prisma } from "shared";
import { prisma } from "@/lib/db";

// Records a permission-related change (see AuditLog in schema.prisma).
// `actor.userId` null = the master password login.
export type AuditActor = { userId: string | null; label: string };

export async function recordAudit(
  actor: AuditActor,
  action: string,
  summary: string,
  detail?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({
    data: { actorId: actor.userId, actorLabel: actor.label, action, summary, detail },
  });
}

export function userLabel(user: { name: string | null; email: string }): string {
  return user.name ? `${user.name}（${user.email}）` : user.email;
}
