import { createHash, randomBytes } from "node:crypto";
import { BASE_PATH } from "@/lib/base-path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeEmail, type User } from "shared";
import { prisma } from "@/lib/db";
import { emailWhere, withEmail } from "@/lib/emails";
import type { RequestContext } from "@/lib/request";

// Regular user authentication (email + password), separate from /admin.
//
// Every page and Server Action that needs a user must call requireUser()
// itself — layouts don't run for Server Actions.

const COOKIE_NAME = "yosuga_session";
// Only sent to this app: under its base path if it shares the host with others.
const COOKIE_PATH = BASE_PATH || "/";

const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
// Don't write lastSeenAt on every request.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const MAX_FAILURES_PER_IP = 10;
const MAX_FAILURES_PER_EMAIL = 10;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

export type CurrentUser = Pick<User, "id" | "name" | "siteRole"> & { email: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Shared with the seeds and the stored hash (shared/src/personal-data.ts).
export { normalizeEmail };

// Only same-origin absolute paths, so ?next= can't send users off-site.
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next.includes("\\")) return fallback;
  return next;
}

// ---- Rate limiting -------------------------------------------------------

export async function isLoginLocked(ip: string, email: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const [byIp, byEmail] = await Promise.all([
    prisma.userLoginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }),
    prisma.userLoginAttempt.count({ where: { ...(await emailWhere(email)), success: false, createdAt: { gte: since } } }),
  ]);
  return byIp >= MAX_FAILURES_PER_IP || byEmail >= MAX_FAILURES_PER_EMAIL;
}

export async function recordLoginAttempt(
  ctx: RequestContext,
  email: string,
  success: boolean,
): Promise<void> {
  await prisma.userLoginAttempt.create({
    data: { ip: ctx.ip, ...(await emailWhere(email)), success, userAgent: ctx.userAgent },
  });
}

// ---- Sessions ------------------------------------------------------------

// Must be called from a Server Action (cookies can't be set while rendering).
export async function createUserSession(ctx: RequestContext, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ABSOLUTE_TIMEOUT_MS);

  await prisma.userSession.deleteMany({
    where: {
      userId,
      OR: [
        { expiresAt: { lt: new Date() } },
        { lastSeenAt: { lt: new Date(Date.now() - IDLE_TIMEOUT_MS) } },
      ],
    },
  });
  await prisma.userSession.create({
    data: { tokenHash: hashToken(token), userId, ip: ctx.ip, userAgent: ctx.userAgent, expiresAt },
  });

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: ctx.secure,
    // Lax (not Strict) so following a link to yosuga from elsewhere still
    // arrives logged in. Server Actions have their own Origin check.
    sameSite: "lax",
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, emailEnc: true, name: true, siteRole: true, disabledAt: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  // Disabling deletes sessions too; this also covers one created concurrently.
  if (
    session.user.disabledAt ||
    session.expiresAt.getTime() <= now ||
    session.lastSeenAt.getTime() <= now - IDLE_TIMEOUT_MS
  ) {
    await prisma.userSession.deleteMany({ where: { tokenHash: session.tokenHash } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.userSession.update({
      where: { tokenHash: session.tokenHash },
      data: { lastSeenAt: new Date() },
    });
  }
  const { id, email, name, siteRole } = await withEmail(session.user);
  return { id, email, name, siteRole };
}

// Gate for every page and Server Action that needs a logged-in user.
// `nextPath` is where to come back to after logging in.
export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return user;
}

// Must be called from a Server Action.
export async function endUserSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.userSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete({ name: COOKIE_NAME, path: COOKIE_PATH });
}
