import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma } from "shared";
import { auditTranslator } from "@/i18n/audit";
import { userLocale } from "@/i18n/locale";
import { type AuditActor, recordAudit, userLabel } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { emailColumns, emailWhere, openOptionalEmail, withEmail } from "@/lib/emails";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { adminEmailChangeCodeMail, emailChangedNoticeMail } from "@/lib/mail-templates";
import { isValidEmail } from "./email-change";
import { getPublicUrl } from "@/lib/site-url";
import { normalizeEmail } from "./session";

// Changing a user's email address from the admin console (site admins). The
// admin enters the new address; a six-digit code is mailed to it, and the
// user enters the code on their account screen, signed in as themselves.
// Until then nothing changes (they still sign in with the old address).
// So the change needs both the account and the new mailbox: an admin can't
// move an account to an address its owner doesn't have.
//
// One request per user (AdminEmailChange); a new one replaces it. The code
// works for ADMIN_EMAIL_CHANGE_TTL_HOURS, MAX_ATTEMPTS wrong tries give it up
// (the user can have a new one mailed, MAX_SENDS times per request). Only a
// hash of the code is kept. Unlike the user's own change, the admin is told
// when the address is another account's: admins see every account anyway.

export const ADMIN_EMAIL_CHANGE_TTL_HOURS = 24;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;

const hashCode = (id: string, code: string) => createHash("sha256").update(`${id}:${code}`).digest("hex");
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

async function mailCode(userId: string, to: string, code: string) {
  await sendMail({
    to,
    ...adminEmailChangeCodeMail(await userLocale(userId), {
      code,
      ttlHours: ADMIN_EMAIL_CHANGE_TTL_HOURS,
      accountUrl: `${await getPublicUrl()}/account`,
    }),
  });
}

export type AdminEmailChangeResult = "sent" | "invalid" | "same" | "taken" | "notFound" | "disabled" | "mail" | "mailFailed";

export async function requestAdminEmailChange(
  actor: AuditActor,
  userId: string,
  rawEmail: string,
): Promise<AdminEmailChangeResult> {
  if (!(await isMailConfigured())) return "mail";
  const found = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, emailEnc: true, disabledAt: true } });
  if (!found) return "notFound";
  if (found.disabledAt) return "disabled";
  const user = await withEmail(found);
  const email = normalizeEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!isValidEmail(email)) return "invalid";
  if (email === normalizeEmail(user.email)) return "same";
  if (await prisma.user.findUnique({ where: await emailWhere(email), select: { id: true } })) return "taken";

  const code = newCode();
  const columns = await emailColumns(email);
  const fields = {
    requestedById: actor.userId,
    newEmailHash: columns.emailHash,
    newEmailEnc: columns.emailEnc,
    attempts: 0,
    sends: 1,
    expiresAt: new Date(Date.now() + ADMIN_EMAIL_CHANGE_TTL_HOURS * 3_600_000),
    createdAt: new Date(),
  };
  const row = await prisma.adminEmailChange.upsert({
    where: { userId },
    create: { userId, codeHash: "", ...fields },
    update: { codeHash: "", ...fields },
    select: { id: true },
  });
  // The hash includes the row id, so equal codes don't hash alike.
  await prisma.adminEmailChange.update({ where: { id: row.id }, data: { codeHash: hashCode(row.id, code) } });
  try {
    await mailCode(userId, email, code);
  } catch (err) {
    console.error("[admin] mailing the email change code failed", err);
    await prisma.adminEmailChange.deleteMany({ where: { id: row.id } });
    return "mailFailed";
  }
  const audit = await auditTranslator();
  await recordAudit(
    actor,
    "user.email.change.request",
    audit("audit.emailChangeRequest", { who: userLabel(user), to: email }),
    { userId },
  );
  return "sent";
}

export type PendingAdminEmailChange = { newEmail: string; expiresAt: Date; canResend: boolean };

// The request waiting for the user's code, if any and still usable.
export async function pendingAdminEmailChange(userId: string): Promise<PendingAdminEmailChange | null> {
  const row = await prisma.adminEmailChange.findUnique({ where: { userId } });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return {
    newEmail: (await openOptionalEmail(row.newEmailEnc)) ?? "",
    expiresAt: row.expiresAt,
    canResend: row.sends < MAX_SENDS,
  };
}

// Cancelled by an admin (the admin console) or turned down by the user.
export async function cancelAdminEmailChange(
  actor: AuditActor,
  userId: string,
  by: "admin" | "user",
): Promise<boolean> {
  const row = await prisma.adminEmailChange.findUnique({ where: { userId }, select: { newEmailEnc: true } });
  if (!row) return false;
  const { count } = await prisma.adminEmailChange.deleteMany({ where: { userId } });
  if (count === 0) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, emailEnc: true } });
  const to = (await openOptionalEmail(row.newEmailEnc)) ?? "";
  const audit = await auditTranslator();
  await recordAudit(
    actor,
    by === "admin" ? "user.email.change.cancel" : "user.email.change.decline",
    by === "admin"
      ? audit("audit.emailChangeCancel", { who: user ? userLabel(await withEmail(user)) : userId, to })
      : audit("audit.emailChangeDecline", { to }),
    { userId },
  );
  return true;
}

export type ResendResult = "sent" | "none" | "tooMany" | "mailFailed";

// A new code for the request (the old one stops working).
export async function resendAdminEmailChangeCode(userId: string): Promise<ResendResult> {
  const row = await prisma.adminEmailChange.findUnique({ where: { userId } });
  if (!row || row.expiresAt.getTime() <= Date.now()) return "none";
  if (row.sends >= MAX_SENDS) return "tooMany";
  const code = newCode();
  // Conditional on the count, so resends at the same moment can't pass the limit.
  const { count } = await prisma.adminEmailChange.updateMany({
    where: { id: row.id, sends: row.sends },
    data: { codeHash: hashCode(row.id, code), attempts: 0, sends: { increment: 1 } },
  });
  if (count !== 1) return "tooMany";
  try {
    await mailCode(userId, (await openOptionalEmail(row.newEmailEnc)) ?? "", code);
  } catch (err) {
    console.error("[account] mailing the email change code failed", err);
    return "mailFailed";
  }
  return "sent";
}

export type ConfirmResult = { ok: true; email: string } | { ok: false; reason: "wrong" | "none" | "taken" };

// The user's code (account screen). Right: the address changes, and the old
// one is told. Every try counts; after MAX_ATTEMPTS wrong ones the code
// stops working (a new one can be mailed).
export async function confirmAdminEmailChange(
  user: { id: string; name: string | null; email: string },
  rawCode: string,
): Promise<ConfirmResult> {
  const row = await prisma.adminEmailChange.findUnique({ where: { userId: user.id } });
  if (!row || row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "none" };
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code) || !row.codeHash) return { ok: false, reason: "wrong" };
  // Counted before comparing, one at a time: tries at the same moment each
  // take one of the MAX_ATTEMPTS.
  const counted = await prisma.adminEmailChange.updateMany({
    where: { id: row.id, codeHash: row.codeHash, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1) return { ok: false, reason: "wrong" };
  const ok = timingSafeEqual(Buffer.from(row.codeHash, "hex"), Buffer.from(hashCode(row.id, code), "hex"));
  if (!ok) return { ok: false, reason: "wrong" };

  try {
    await prisma.$transaction(async (tx) => {
      // Used once, even with two tries at the same moment.
      const used = await tx.adminEmailChange.deleteMany({ where: { id: row.id, codeHash: row.codeHash } });
      if (used.count !== 1) throw new Error("used");
      await tx.user.update({
        where: { id: user.id },
        // The code reached the address: it's the account's.
        data: { emailHash: row.newEmailHash, emailEnc: row.newEmailEnc, emailUnconfirmed: false },
      });
      // A link the user asked for themselves stops working.
      await tx.emailChangeRequest.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    });
  } catch (err) {
    // Another account took the address in the meantime (emailHash is unique).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await prisma.adminEmailChange.deleteMany({ where: { id: row.id } });
      return { ok: false, reason: "taken" };
    }
    if (err instanceof Error && err.message === "used") return { ok: false, reason: "none" };
    throw err;
  }

  const email = (await openOptionalEmail(row.newEmailEnc)) ?? "";
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel({ name: user.name, email }) },
    "user.email.change",
    audit("audit.emailChangeByAdmin", { from: user.email, to: email }),
    { userId: user.id, byAdmin: true },
  );
  if (user.email) {
    try {
      await sendMail({ to: user.email, ...emailChangedNoticeMail(await userLocale(user.id), { newEmail: email }) });
    } catch (err) {
      console.error("[account] telling the old address about the change failed", err);
    }
  }
  return { ok: true, email };
}
