import { createHash, randomBytes } from "node:crypto";
import { BASE_PATH } from "@/lib/base-path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type LoginMethod, normalizeEmail, type User } from "shared";
import { prisma } from "@/lib/db";
import { emailWhere, withEmail } from "@/lib/emails";
import type { RequestContext } from "@/lib/request";

// Regular user authentication (email + password), separate from /admin.
//
// Every page and Server Action that needs a user must call requireUser()
// itself — layouts don't run for Server Actions.
//
// When the site requires passkeys (InstanceConfig.passkeyRequired), a session
// signed in with a password by an account that has none yet counts as not
// signed in everywhere — getCurrentUser() returns null, so pages, Server
// Actions, Route Handlers and collab tokens all refuse it — except the
// registration screen (/passkey-setup, getPasskeySetupUser()). requireUser()
// sends it there.

const COOKIE_NAME = "knowlective_session";
// Only sent to this app: under its base path if it shares the host with others.
export const COOKIE_PATH = BASE_PATH || "/";

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

// The IP part of isLoginLocked(), for sign-ins without an address (passkeys).
export async function isIpLoginLocked(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const failures = await prisma.userLoginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } });
  return failures >= MAX_FAILURES_PER_IP;
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
export async function createUserSession(ctx: RequestContext, userId: string, method: LoginMethod): Promise<void> {
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
    data: { tokenHash: hashToken(token), userId, method, ip: ctx.ip, userAgent: ctx.userAgent, expiresAt },
  });

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: ctx.secure,
    // Lax (not Strict) so following a link to knowlective from elsewhere still
    // arrives logged in. Server Actions have their own Origin check.
    sameSite: "lax",
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

// Single sign-on sessions don't need a passkey: the IdP authenticates. A
// session from before the method was recorded counts as one if the account
// is linked to an IdP.
export function passkeyExempt(method: LoginMethod | null, oidcSubject: string | null): boolean {
  return method === "OIDC" || (method === null && oidcSubject !== null);
}

export async function passkeyRequiredSetting(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { passkeyRequired: true } });
  return config?.passkeyRequired ?? false;
}

// How and when this session was signed in (confirming who someone is: lib/auth/reauth.ts).
export type SessionInfo = { method: LoginMethod | null; createdAt: Date };

type SessionState = {
  user: CurrentUser;
  passkeyExempt: boolean;
  passkeySetupRequired: boolean;
  session: SessionInfo;
};

async function loadSession(): Promise<SessionState | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          emailEnc: true,
          name: true,
          siteRole: true,
          disabledAt: true,
          oidcSubject: true,
          _count: { select: { passkeys: true } },
        },
      },
    },
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
  const exempt = passkeyExempt(session.method, session.user.oidcSubject);
  const passkeySetupRequired =
    session.user._count.passkeys === 0 && !exempt && (await passkeyRequiredSetting());
  const { id, email, name, siteRole } = await withEmail(session.user);
  return {
    user: { id, email, name, siteRole },
    passkeyExempt: exempt,
    passkeySetupRequired,
    session: { method: session.method, createdAt: session.createdAt },
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const state = await loadSession();
  return state && !state.passkeySetupRequired ? state.user : null;
}

// The signed-in user who still has to register a passkey (the site requires
// one), or null: for /passkey-setup and its Server Actions only.
export async function getPasskeySetupUser(): Promise<CurrentUser | null> {
  const state = await loadSession();
  return state?.passkeySetupRequired ? state.user : null;
}

// The signed-in user, setup pending or not, and whether this session is
// exempt from requiring a passkey (single sign-on): for managing passkeys.
export async function getSessionUser(): Promise<{
  user: CurrentUser;
  passkeyExempt: boolean;
  session: SessionInfo;
} | null> {
  const state = await loadSession();
  return state && { user: state.user, passkeyExempt: state.passkeyExempt, session: state.session };
}

// The display language the signed-in user chose, if any. Only for picking
// the language: it skips getCurrentUser()'s checks (an expired or disabled
// session is turned away by those anyway).
export async function sessionUserLocale(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { user: { select: { locale: true } } },
  });
  return session?.user.locale ?? null;
}

// Gate for every page and Server Action that needs a logged-in user.
// `nextPath` is where to come back to after logging in.
export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const state = await loadSession();
  const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  if (!state) redirect(`/login${next}`);
  if (state.passkeySetupRequired) redirect(`/passkey-setup${next}`);
  return state.user;
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
