import { createHash, randomBytes } from "node:crypto";
import type { SignupMode, SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { emailColumns, emailWhere } from "@/lib/emails";
import { isMailConfigured } from "@/lib/mail";

// Self-registration (/signup). Off by default: accounts come from admin
// invitations only. When an admin turns it on (needs mail settings), anyone
// with an allowed email domain can ask for a link; the link is mailed to the
// address, which proves they own it, and opens the usual /invite/<token>
// registration page. The account gets the role the admin chose (USER by
// default, or CONTENT_MANAGER — never SITE_ADMIN) and no groups.

export const SIGNUP_TTL_HOURS = 24;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 5;
const MAX_REQUESTS_PER_EMAIL = 3;
const MAX_DOMAINS = 50;

// Roles self-registered accounts may get.
export const SIGNUP_ROLES = ["USER", "CONTENT_MANAGER"] as const satisfies readonly SiteRole[];
export type SignupRole = (typeof SIGNUP_ROLES)[number];
export const isSignupRole = (value: unknown): value is SignupRole => SIGNUP_ROLES.includes(value as SignupRole);

export type SignupSettings = {
  mode: SignupMode;
  allowedDomains: string[];
  siteRole: SignupRole;
  mailConfigured: boolean;
  // OPEN, and mail can actually be sent.
  enabled: boolean;
};

export async function getSignupSettings(): Promise<SignupSettings> {
  const [config, mailConfigured] = await Promise.all([
    prisma.instanceConfig.findUnique({
      where: { id: 1 },
      select: { signupMode: true, signupAllowedDomains: true, signupSiteRole: true },
    }),
    isMailConfigured(),
  ]);
  const mode = config?.signupMode ?? "INVITE_ONLY";
  return {
    mode,
    allowedDomains: config?.signupAllowedDomains ?? [],
    // Anything else (e.g. edited in the database) falls back to the safe default.
    siteRole: isSignupRole(config?.signupSiteRole) ? config.signupSiteRole : "USER",
    mailConfigured,
    enabled: mode === "OPEN" && mailConfigured,
  };
}

// "example.co.jp, @sub.example.com" (commas, spaces or newlines) → clean
// list, or null if any entry isn't a domain name.
export function parseDomains(raw: string): string[] | null {
  const entries = raw
    .split(/[\s,、]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (entries.length > MAX_DOMAINS) return null;
  const valid = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
  if (entries.some((d) => !valid.test(d))) return null;
  return [...new Set(entries)];
}

// Exact domain match (subdomains must be listed themselves). Empty list = any.
export function isDomainAllowed(email: string, domains: string[]): boolean {
  if (domains.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return domains.includes(domain);
}

// Whether this IP / address may ask for another link right now.
export async function isSignupRateLimited(ip: string, email: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const [byIp, byEmail] = await Promise.all([
    prisma.invitation.count({ where: { selfSignup: true, requestedIp: ip, createdAt: { gt: since } } }),
    prisma.invitation.count({ where: { selfSignup: true, ...(await emailWhere(email)), createdAt: { gt: since } } }),
  ]);
  return byIp >= MAX_REQUESTS_PER_IP || byEmail >= MAX_REQUESTS_PER_EMAIL;
}

// A single-use registration link bound to `email`. Same token scheme as
// admin invitations (lib/auth/invitations.ts): only its hash is stored.
// The role stored here is informational: register() applies the current
// setting when the account is created.
export async function createSignupInvitation(email: string, ip: string, siteRole: SignupRole): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      ...(await emailColumns(email)),
      siteRole,
      selfSignup: true,
      requestedIp: ip,
      expiresAt: new Date(Date.now() + SIGNUP_TTL_HOURS * 60 * 60 * 1000),
    },
  });
  return token;
}
