import { createHmac, hkdfSync } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "./crypto";

// Email addresses and the audit log, encrypted with the data key (DEK) like
// page content: the database alone doesn't tell who has an account, who was
// invited, or what the audit log says.
//
// An email is stored twice:
//   - emailEnc:  AES-GCM ciphertext, for showing and mailing it;
//   - emailHash: HMAC-SHA256 of the normalized address under a key derived
//                from the DEK — the same address always gives the same hash,
//                so it stands in for the address in lookups, uniqueness and
//                rate-limit counts. Without the DEK it can't be checked
//                against a guessed address.

const EMAIL_INDEX_INFO = "knowlective:email-index:v1";
const EMAIL_AAD = "knowlective:email";
const AUDIT_AAD = "knowlective:audit-log";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const indexKeys = new WeakMap<Uint8Array, Buffer>();
function indexKey(dataKey: Uint8Array): Buffer {
  let key = indexKeys.get(dataKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", dataKey, Buffer.alloc(0), EMAIL_INDEX_INFO, 32));
    indexKeys.set(dataKey, key);
  }
  return key;
}

export function emailHash(dataKey: Uint8Array, email: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHmac("sha256", indexKey(dataKey)).update(normalizeEmail(email)).digest());
}

// The columns to write for an address (normalized first).
export function sealEmail(dataKey: Uint8Array, email: string) {
  return {
    emailHash: emailHash(dataKey, email),
    emailEnc: Uint8Array.from(encrypt(dataKey, Buffer.from(normalizeEmail(email), "utf8"), EMAIL_AAD)),
  };
}

export function openEmail(dataKey: Uint8Array, emailEnc: Uint8Array): string {
  return decrypt(dataKey, emailEnc, EMAIL_AAD).toString("utf8");
}

// An audit log entry's text (who, what, details), bound to the entry's id so
// it can't be moved onto another entry.
export function sealAudit(dataKey: Uint8Array, id: string, value: unknown): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(encrypt(dataKey, Buffer.from(JSON.stringify(value), "utf8"), `${AUDIT_AAD}:${id}`));
}

export function openAudit<T>(dataKey: Uint8Array, id: string, sealed: Uint8Array): T {
  return JSON.parse(decrypt(dataKey, sealed, `${AUDIT_AAD}:${id}`).toString("utf8")) as T;
}

// Rows written before this encryption keep their plaintext in legacy*
// columns. The server converts them once at startup, before it takes
// requests (it needs the DEK, so a SQL migration can't): fills the encrypted
// columns and clears the plaintext. Returns how many rows it changed.
export async function encryptLegacyPersonalData(prisma: PrismaClient, dataKey: Uint8Array): Promise<number> {
  let changed = 0;
  const users = await prisma.user.findMany({ where: { legacyEmail: { not: null } }, select: { id: true, legacyEmail: true } });
  for (const u of users) {
    await prisma.user.update({ where: { id: u.id }, data: { ...sealEmail(dataKey, u.legacyEmail!), legacyEmail: null } });
  }
  changed += users.length;

  const invitations = await prisma.invitation.findMany({
    where: { legacyEmail: { not: null } },
    select: { id: true, legacyEmail: true },
  });
  for (const i of invitations) {
    await prisma.invitation.update({ where: { id: i.id }, data: { ...sealEmail(dataKey, i.legacyEmail!), legacyEmail: null } });
  }
  changed += invitations.length;

  const adminAttempts = await prisma.adminLoginAttempt.findMany({
    where: { legacyEmail: { not: null } },
    select: { id: true, legacyEmail: true },
  });
  for (const a of adminAttempts) {
    await prisma.adminLoginAttempt.update({
      where: { id: a.id },
      data: { ...sealEmail(dataKey, a.legacyEmail!), legacyEmail: null },
    });
  }
  changed += adminAttempts.length;

  const userAttempts = await prisma.userLoginAttempt.findMany({
    where: { legacyEmail: { not: null } },
    select: { id: true, legacyEmail: true },
  });
  for (const a of userAttempts) {
    await prisma.userLoginAttempt.update({
      where: { id: a.id },
      data: { emailHash: emailHash(dataKey, a.legacyEmail!), legacyEmail: null },
    });
  }
  changed += userAttempts.length;

  const logs = await prisma.auditLog.findMany({
    where: { sealed: null },
    select: { id: true, legacyActorLabel: true, legacySummary: true, legacyDetail: true },
  });
  for (const log of logs) {
    const entry: AuditText = { actorLabel: log.legacyActorLabel ?? "", summary: log.legacySummary ?? "", detail: log.legacyDetail ?? null };
    await prisma.auditLog.update({
      where: { id: log.id },
      data: {
        sealed: sealAudit(dataKey, log.id, entry),
        legacyActorLabel: null,
        legacySummary: null,
        legacyDetail: Prisma.DbNull,
      },
    });
  }
  changed += logs.length;
  return changed;
}

// The sealed part of an audit log entry.
export type AuditText = { actorLabel: string; summary: string; detail: Prisma.JsonValue | null };
