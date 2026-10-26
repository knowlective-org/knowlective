import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "shared";
import { auditTranslator } from "@/i18n/audit";
import { siteDefaultLocale, userLocale } from "@/i18n/locale";
import { recordAudit, userLabel } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { emailColumns, emailWhere, openOptionalEmail, withEmail } from "@/lib/emails";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { emailChangeConfirmMail, emailChangeInUseMail, emailChangedNoticeMail } from "@/lib/mail-templates";
import { getPublicUrl } from "@/lib/site-url";
import { normalizeEmail } from "./session";

// Changing a signed-in user's email address (account screen). The caller has
// confirmed it's them first (lib/auth/reauth.ts). A link is mailed to the new
// address; the change happens only when it's opened and confirmed, and the
// old address is told. Whether the new address belongs to another account
// isn't shown on the screen (so addresses can't be probed): that mail says it
// can't be used instead.

export const EMAIL_CHANGE_TTL_MINUTES = 60;
// Requests per user within an hour.
const MAX_REQUESTS_PER_HOUR = 5;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function isValidEmail(email: string): boolean {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) && email.length <= 254;
}

export type StartEmailChangeResult = "sent" | "invalid" | "same" | "tooMany";

export async function startEmailChange(
  user: { id: string; email: string },
  rawEmail: string,
): Promise<StartEmailChangeResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return "invalid";
  if (email === normalizeEmail(user.email)) return "same";
  const recent = await prisma.emailChangeRequest.count({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_REQUESTS_PER_HOUR) return "tooMany";

  const taken = await prisma.user.findUnique({ where: await emailWhere(email), select: { id: true } });
  if (taken) {
    // Told to the new address only, in the site's language (whoever owns it
    // may have no account here… or a different one).
    await sendMail({ to: email, ...emailChangeInUseMail(await siteDefaultLocale()) });
    return "sent";
  }

  const token = randomBytes(32).toString("base64url");
  const columns = await emailColumns(email);
  await prisma.$transaction([
    // An older request stops working.
    prisma.emailChangeRequest.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.emailChangeRequest.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        newEmailHash: columns.emailHash,
        newEmailEnc: columns.emailEnc,
        expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60_000),
      },
    }),
  ]);
  await sendMail({
    to: email,
    ...emailChangeConfirmMail(await userLocale(user.id), {
      link: `${await getPublicUrl()}/email-change/${token}`,
      ttlMinutes: EMAIL_CHANGE_TTL_MINUTES,
    }),
  });
  return "sent";
}

export type DirectEmailChangeResult = "changed" | "invalid" | "same" | "taken";

// Changes the address at once, unconfirmed (profileRules() "direct": single
// sign-on accounts, when the admin console allows it). The address can't be
// one another account has; saying so here can't be avoided (there's no mail
// to say it in instead). The old address is told when mail is set up.
export async function changeEmailWithoutConfirmation(
  user: { id: string; email: string; name: string | null },
  rawEmail: string,
): Promise<DirectEmailChangeResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return "invalid";
  if (email === normalizeEmail(user.email)) return "same";
  const columns = await emailColumns(email);
  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: columns }),
      // A link asked for before stops working.
      prisma.emailChangeRequest.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "taken";
    throw err;
  }
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel({ name: user.name, email }) },
    "user.email.change",
    audit("audit.emailChangeUnconfirmed", { from: user.email, to: email }),
    { userId: user.id, unconfirmed: true },
  );
  if (user.email && (await isMailConfigured())) {
    try {
      await sendMail({ to: user.email, ...emailChangedNoticeMail(await userLocale(user.id), { newEmail: email }) });
    } catch (err) {
      console.error("[account] telling the old address about the change failed", err);
    }
  }
  return "changed";
}

type OpenRequest = { id: string; userId: string; newEmail: string; currentEmail: string };

// The request a link stands for, while it can still be used.
export async function findEmailChange(token: string): Promise<OpenRequest | null> {
  if (typeof token !== "string" || !token) return null;
  const row = await prisma.emailChangeRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { emailEnc: true, disabledAt: true } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.user.disabledAt) return null;
  return {
    id: row.id,
    userId: row.userId,
    newEmail: (await openOptionalEmail(row.newEmailEnc)) ?? "",
    currentEmail: (await openOptionalEmail(row.user.emailEnc)) ?? "",
  };
}

export type CompleteEmailChangeResult = { ok: true; email: string } | { ok: false; reason: "invalid" | "taken" };

// Makes the change (the link's confirm button). The old address is told.
export async function completeEmailChange(token: string): Promise<CompleteEmailChangeResult> {
  const request = await findEmailChange(token);
  if (!request) return { ok: false, reason: "invalid" };
  const row = await prisma.emailChangeRequest.findUniqueOrThrow({
    where: { id: request.id },
    select: { newEmailHash: true, newEmailEnc: true },
  });
  try {
    await prisma.$transaction(async (tx) => {
      // Used once, even with two clicks at the same moment.
      const used = await tx.emailChangeRequest.updateMany({
        where: { id: request.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw new Error("used");
      await tx.user.update({
        where: { id: request.userId },
        data: { emailHash: row.newEmailHash, emailEnc: row.newEmailEnc },
      });
    });
  } catch (err) {
    // Another account took the address in the meantime (emailHash is unique).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, reason: "taken" };
    if (err instanceof Error && err.message === "used") return { ok: false, reason: "invalid" };
    throw err;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId }, select: { name: true, emailEnc: true } });
  const opened = await withEmail(user);
  const audit = await auditTranslator();
  await recordAudit(
    { userId: request.userId, label: userLabel(opened) },
    "user.email.change",
    audit("audit.emailChange", { from: request.currentEmail, to: request.newEmail }),
    { userId: request.userId },
  );
  if (request.currentEmail) {
    try {
      await sendMail({
        to: request.currentEmail,
        ...emailChangedNoticeMail(await userLocale(request.userId), { newEmail: request.newEmail }),
      });
    } catch (err) {
      console.error("[account] telling the old address about the change failed", err);
    }
  }
  return { ok: true, email: request.newEmail };
}
