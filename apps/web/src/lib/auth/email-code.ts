import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { userLocale } from "@/i18n/locale";
import { sendMail } from "@/lib/mail";
import { emailCodeMail } from "@/lib/mail-templates";
import type { CurrentUser } from "./session";

// One-time codes mailed to the signed-in user, to confirm it's them (issuing
// an API key or changing the email address, without a passkey). Six digits, valid for CODE_TTL_MINUTES,
// usable once; a newer code replaces older ones, and after MAX_ATTEMPTS wrong
// tries the code is given up. Only a hash of the code is stored.

export type EmailCodePurpose = "api-key" | "email-change";
export const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
// Codes mailed per user and purpose within an hour.
const MAX_SENDS_PER_HOUR = 5;

const hashCode = (id: string, code: string) => createHash("sha256").update(`${id}:${code}`).digest("hex");

export type SendCodeResult = "sent" | "tooMany";

// Mails a new code to the user's address (errors from sending propagate).
export async function sendEmailCode(user: CurrentUser, purpose: EmailCodePurpose): Promise<SendCodeResult> {
  const recent = await prisma.emailCode.count({
    where: { userId: user.id, purpose, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_SENDS_PER_HOUR) return "tooMany";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();
  const [, row] = await prisma.$transaction([
    // Older codes stop working.
    prisma.emailCode.updateMany({ where: { userId: user.id, purpose, usedAt: null }, data: { usedAt: now } }),
    prisma.emailCode.create({
      data: { userId: user.id, purpose, codeHash: "", expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000) },
      select: { id: true },
    }),
  ]);
  // The hash includes the row id, so equal codes don't hash alike.
  await prisma.emailCode.update({ where: { id: row.id }, data: { codeHash: hashCode(row.id, code) } });
  await sendMail({
    to: user.email,
    ...emailCodeMail(await userLocale(user.id), { code, ttlMinutes: CODE_TTL_MINUTES }),
  });
  return "sent";
}

// Whether `code` is the user's current code for `purpose`; using it (right or
// wrong) counts, and a right one can't be used again.
export async function checkEmailCode(userId: string, purpose: EmailCodePurpose, code: string): Promise<boolean> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const row = await prisma.emailCode.findFirst({
    where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row || !row.codeHash) return false;
  const ok = timingSafeEqual(Buffer.from(row.codeHash, "hex"), Buffer.from(hashCode(row.id, normalized), "hex"));
  const attempts = row.attempts + 1;
  // Conditional on still unused: two tries at once can't both succeed.
  const { count } = await prisma.emailCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { attempts, ...(ok || attempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}) },
  });
  return ok && count === 1;
}
