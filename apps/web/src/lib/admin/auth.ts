import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { AdminSession } from "shared";
import { decrypt, encrypt, loadDataKey } from "shared";
import { withBasePath } from "@/lib/base-path";
import { prisma } from "@/lib/db";
import { emailColumns, withEmail } from "@/lib/emails";
import type { SiteRole } from "shared";
import { getAdminConsoleRole } from "@/lib/roles";
import { userLabel } from "@/lib/audit";
import { isIpAllowed } from "@/lib/ip";
import { type RequestContext, getRequestContext } from "@/lib/request";

// Admin (/admin) authentication, IP allowlist, login rate limiting, and
// short-lived sessions separate from user sessions.
//
// Two ways in, both requiring TOTP:
// - A user account whose site role is SITE_ADMIN or CONTENT_MANAGER (normal
//   use). The role is re-checked on every request, so a demotion or
//   disabling takes effect immediately.
// - The master password (bootstrap: adding the first site admin; recovery).
//
// Every admin page AND every admin Server Action must call requireAdmin()
// (or the login-specific checks) itself. Layouts are not a security boundary:
// Server Actions are separate POST entry points that don't run them.

const COOKIE_NAME = "yosuga_admin";
// Only sent to the admin console (under the base path, if there is one).
const COOKIE_PATH = withBasePath("/admin");

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
// Sessions that aren't fully signed in yet (ENROLL_TOTP / VERIFY_TOTP).
const ENROLL_TIMEOUT_MS = 10 * 60 * 1000;
// Don't write lastSeenAt on every request.
const TOUCH_INTERVAL_MS = 60 * 1000;

export const MAX_FAILURES = 5;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

// The AAD binds each encrypted TOTP secret to its owner, so a secret can't be
// copied from one account (or the master login) to another.
const totpAad = (userId: string | null) =>
  userId ? `yosuga:user-totp:${userId}` : "yosuga:admin-totp";

export async function getAdminConfig() {
  const config = await prisma.instanceConfig.findUnique({
    where: { id: 1 },
    select: { totpSecret: true, totpLastStep: true, adminIpAllowlist: true },
  });
  if (!config) redirect("/setup");
  return config;
}

// Respond as if /admin didn't exist, so a disallowed network learns nothing.
export function assertIpAllowed(ip: string, allowlist: string[]): void {
  if (!isIpAllowed(ip, allowlist)) notFound();
}

// userId null = the master password login's TOTP secret.
export async function encryptTotpSecret(
  secret: Uint8Array,
  userId: string | null,
): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(encrypt(await loadDataKey(prisma), secret, totpAad(userId)));
}

export async function decryptTotpSecret(stored: Uint8Array, userId: string | null): Promise<Buffer> {
  return decrypt(await loadDataKey(prisma), stored, totpAad(userId));
}

// ---- Rate limiting -------------------------------------------------------

// Locked when the IP has MAX_FAILURES bad-credential attempts within the
// window since its last successful login.
export async function getLockState(ip: string): Promise<{ locked: boolean; remaining: number }> {
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const lastSuccess = await prisma.adminLoginAttempt.findFirst({
    where: { ip, success: true, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const failures = await prisma.adminLoginAttempt.count({
    where: {
      ip,
      success: false,
      reason: "bad_credentials",
      createdAt: { gt: lastSuccess?.createdAt ?? since },
    },
  });
  return { locked: failures >= MAX_FAILURES, remaining: Math.max(0, MAX_FAILURES - failures) };
}

export async function recordLoginAttempt(
  ctx: RequestContext,
  success: boolean,
  reason?: string,
  email?: string,
): Promise<void> {
  await prisma.adminLoginAttempt.create({
    data: { ip: ctx.ip, success, reason, ...(email ? await emailColumns(email) : {}), userAgent: ctx.userAgent },
  });
}

// ---- Sessions ------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Must be called from a Server Action (cookies can't be set while rendering).
export async function createAdminSession(
  ctx: RequestContext,
  stage: AdminSession["stage"],
  options: { userId?: string; pendingTotp?: Uint8Array<ArrayBuffer> } = {},
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const ttl = stage === "ACTIVE" ? ABSOLUTE_TIMEOUT_MS : ENROLL_TIMEOUT_MS;
  const expiresAt = new Date(Date.now() + ttl);

  // Opportunistic cleanup; there are only ever a handful of admin sessions.
  await prisma.adminSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { lastSeenAt: { lt: new Date(Date.now() - IDLE_TIMEOUT_MS) } },
      ],
    },
  });
  await prisma.adminSession.create({
    data: {
      tokenHash: hashToken(token),
      stage,
      userId: options.userId,
      pendingTotp: options.pendingTotp,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      expiresAt,
    },
  });

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: ctx.secure,
    sameSite: "strict",
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

const sessionInclude = { user: { select: { id: true, emailEnc: true, name: true } } } as const;
export type AdminSessionWithUser = AdminSession & {
  user: { id: string; email: string; name: string | null } | null;
};

// Returns the current session if it exists and hasn't hit either timeout.
export async function getAdminSession(): Promise<AdminSessionWithUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: sessionInclude,
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() <= now - IDLE_TIMEOUT_MS) {
    await prisma.adminSession.deleteMany({ where: { tokenHash: session.tokenHash } });
    return null;
  }
  return withSessionUser(session);
}

export async function listActiveAdminSessions(): Promise<AdminSessionWithUser[]> {
  const sessions = await prisma.adminSession.findMany({
    include: sessionInclude,
    where: {
      stage: "ACTIVE",
      expiresAt: { gt: new Date() },
      lastSeenAt: { gt: new Date(Date.now() - IDLE_TIMEOUT_MS) },
    },
    orderBy: { lastSeenAt: "desc" },
  });
  return Promise.all(sessions.map(withSessionUser));
}

// The session's user with their address opened.
async function withSessionUser<T extends { user: { id: string; emailEnc: Uint8Array | null; name: string | null } | null }>(
  session: T,
): Promise<Omit<T, "user"> & { user: { id: string; email: string; name: string | null } | null }> {
  return { ...session, user: session.user ? await withEmail(session.user) : null };
}

// Must be called from a Server Action.
export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete({ name: COOKIE_NAME, path: COOKIE_PATH });
}

// Gate for every admin page and admin Server Action. `allowed` limits the
// page/action to some roles (e.g. settings are SITE_ADMIN only); a content
// manager sent somewhere it can't go lands on the users page instead. The
// master password session counts as SITE_ADMIN.
export async function requireAdmin(allowed: SiteRole[] = ["SITE_ADMIN", "CONTENT_MANAGER"]) {
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  assertIpAllowed(ctx.ip, config.adminIpAllowlist);

  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (session.stage === "VERIFY_TOTP") redirect("/admin/login/verify");
  if (session.stage !== "ACTIVE") redirect("/admin/enroll");

  // Demoted or disabled since signing in: end the session now.
  let role: SiteRole = "SITE_ADMIN";
  if (session.userId) {
    const current = await getAdminConsoleRole(session.userId);
    if (!current) {
      await prisma.adminSession.deleteMany({ where: { tokenHash: session.tokenHash } });
      redirect("/admin/login");
    }
    role = current;
  }
  if (!allowed.includes(role)) redirect("/admin/users");

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.adminSession.update({
      where: { tokenHash: session.tokenHash },
      data: { lastSeenAt: new Date() },
    });
  }
  // Display name for "who is signed in"; "マスターパスワード" for the master login.
  const actorLabel = session.user ? (session.user.name ?? session.user.email) : "マスターパスワード";
  // Who is acting, for the audit log and group access checks.
  const actor = {
    userId: session.userId,
    label: session.user ? userLabel(session.user) : "マスターパスワード",
    role,
  };
  return { ctx, config, session, actorLabel, role, actor };
}
