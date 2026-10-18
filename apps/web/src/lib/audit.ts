import { randomUUID } from "node:crypto";
import { type AuditText, type Prisma, loadDataKey, openAudit, sealAudit } from "shared";
import { prisma } from "@/lib/db";

// Records a permission-related change (see AuditLog in schema.prisma).
// `actor.userId` null = the master password login. The text (who, what,
// details — it names people and their addresses) is stored encrypted.
export type AuditActor = { userId: string | null; label: string };

export async function recordAudit(
  actor: AuditActor,
  action: string,
  summary: string,
  detail?: Prisma.InputJsonValue,
): Promise<void> {
  // The id is chosen here: the sealed text is bound to it.
  const id = randomUUID();
  const text: AuditText = { actorLabel: actor.label, summary, detail: (detail ?? null) as AuditText["detail"] };
  await prisma.auditLog.create({
    data: { id, actorId: actor.userId, action, sealed: sealAudit(await loadDataKey(prisma), id, text) },
  });
}

export async function countAuditLogs(): Promise<number> {
  return prisma.auditLog.count();
}

// Entries, newest first (skipping the newest `skip`), opened.
export async function listAuditLogs(take: number, skip = 0) {
  const logs = await prisma.auditLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, skip });
  if (logs.length === 0) return [];
  const key = await loadDataKey(prisma);
  return logs.map((log) => {
    const text = log.sealed
      ? openAudit<AuditText>(key, log.id, log.sealed)
      : // Not converted yet (the server does it at startup).
        { actorLabel: log.legacyActorLabel ?? "", summary: log.legacySummary ?? "", detail: log.legacyDetail };
    return { id: log.id, createdAt: log.createdAt, action: log.action, ...text };
  });
}

// "Name (address)": the same in every language.
export function userLabel(user: { name: string | null; email: string }): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
}
