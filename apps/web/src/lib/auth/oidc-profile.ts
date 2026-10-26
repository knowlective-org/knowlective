import type { PrismaClient } from "shared";
import { auditTranslator } from "@/i18n/audit";
import { recordAudit } from "@/lib/audit";

// What single sign-on takes from the identity provider at every sign-in
// (lib/auth/oidc.ts): the display name (a template of claims) and the groups
// (a claim's values). Claims come from the ID token and the UserInfo
// endpoint; UserInfo's win when both have one.

// A claim name, or a dotted path to a nested one ("profile.name").
export const CLAIM_PATH = /^[A-Za-z0-9_:\-]+(\.[A-Za-z0-9_:\-]+)*$/;
export const MAX_TEMPLATE_LENGTH = 200;
const MAX_NAME_LENGTH = 100;
// Groups taken from one sign-in, and the length of a group's name.
const MAX_GROUPS = 100;
const MAX_GROUP_NAME_LENGTH = 100;

export type Claims = Record<string, unknown>;

function claimValue(claims: Claims, path: string): unknown {
  let value: unknown = claims;
  for (const key of path.split(".")) {
    value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  }
  return value;
}

function claimText(claims: Claims, path: string): string | null {
  const value = claimValue(claims, path);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

// A display-name setting as written in the admin console: a bare claim
// ("name"), or text with {claim} placeholders ("{family_name} {given_name}",
// "{name}@{department}"). Null when it isn't valid. "" is the default.
export function parseNameTemplate(input: string): { parts: (string | { claim: string })[] } | null {
  if (input.length > MAX_TEMPLATE_LENGTH) return null;
  if (!input.includes("{") && !input.includes("}")) {
    return input === "" || CLAIM_PATH.test(input) ? { parts: input ? [{ claim: input }] : [] } : null;
  }
  const parts: (string | { claim: string })[] = [];
  let rest = input;
  while (rest) {
    const open = rest.indexOf("{");
    const close = rest.indexOf("}");
    if (open === -1) {
      if (close !== -1) return null;
      parts.push(rest);
      break;
    }
    if (close !== -1 && close < open) return null;
    if (open > 0) parts.push(rest.slice(0, open));
    const end = rest.indexOf("}", open);
    if (end === -1) return null;
    const claim = rest.slice(open + 1, end).trim();
    if (!CLAIM_PATH.test(claim)) return null;
    parts.push({ claim });
    rest = rest.slice(end + 1);
  }
  return parts.some((p) => typeof p !== "string") ? { parts } : null;
}

// The display name from the claims, or null if it comes out empty (a
// template whose claims are all missing). Default: "name", else
// "preferred_username".
export function renderDisplayName(template: string | null, claims: Claims): string | null {
  const parsed = template ? parseNameTemplate(template) : null;
  if (!parsed || parsed.parts.length === 0) {
    return (claimText(claims, "name") ?? claimText(claims, "preferred_username"))?.slice(0, MAX_NAME_LENGTH) ?? null;
  }
  const values = parsed.parts.map((p) => (typeof p === "string" ? null : claimText(claims, p.claim)));
  // Nothing from the IdP: no name (fixed text alone isn't one).
  if (values.every((v) => v === null)) return null;
  const text = parsed.parts.map((p, i) => (typeof p === "string" ? p : (values[i] ?? ""))).join("");
  const name = text.replace(/\s+/g, " ").trim();
  return name ? name.slice(0, MAX_NAME_LENGTH) : null;
}

// The group names in a claim: a string, or an array of strings (numbers
// too). Null when the claim is absent.
export function groupNames(claims: Claims, path: string): string[] | null {
  const value = claimValue(claims, path);
  if (value === undefined || value === null) return null;
  const list = Array.isArray(value) ? value : [value];
  const names = list
    .map((v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""))
    .filter((v) => v && v.length <= MAX_GROUP_NAME_LENGTH);
  return [...new Set(names)].slice(0, MAX_GROUPS);
}

// Makes the user's single sign-on memberships those of `names`: each name is
// the group of that name (made if there's none; built-in groups never). Only
// memberships the sync added (viaOidc) are taken away; ones added by hand stay.
// Recorded in the audit log when anything changed (memberships are access).
export async function syncOidcGroups(
  prisma: PrismaClient,
  user: { id: string; label: string },
  names: string[],
): Promise<void> {
  const found = names.length
    ? await prisma.group.findMany({ where: { name: { in: names } }, select: { id: true, name: true, builtIn: true } })
    : [];
  const byName = new Map(found.map((g) => [g.name, g]));
  const created: string[] = [];
  for (const name of names) {
    if (byName.has(name)) continue;
    try {
      const group = await prisma.group.create({ data: { name, oidcCreated: true }, select: { id: true, name: true, builtIn: true } });
      byName.set(name, group);
      created.push(name);
    } catch {
      // Made at the same moment by another sign-in.
      const group = await prisma.group.findUnique({ where: { name }, select: { id: true, name: true, builtIn: true } });
      if (group) byName.set(name, group);
    }
  }
  const wanted = new Map([...byName.values()].filter((g) => g.builtIn === null).map((g) => [g.id, g.name]));

  const current = await prisma.groupMember.findMany({
    where: { userId: user.id },
    select: { groupId: true, viaOidc: true, group: { select: { name: true } } },
  });
  const memberOf = new Set(current.map((m) => m.groupId));
  const added = [...wanted].filter(([id]) => !memberOf.has(id));
  const removed = current.filter((m) => m.viaOidc && !wanted.has(m.groupId));
  if (added.length === 0 && removed.length === 0 && created.length === 0) return;

  await prisma.$transaction([
    ...(added.length > 0
      ? [prisma.groupMember.createMany({ data: added.map(([groupId]) => ({ groupId, userId: user.id, viaOidc: true })), skipDuplicates: true })]
      : []),
    ...(removed.length > 0
      ? [prisma.groupMember.deleteMany({ where: { userId: user.id, viaOidc: true, groupId: { in: removed.map((m) => m.groupId) } } })]
      : []),
  ]);
  const audit = await auditTranslator();
  const list = (names: string[]) => (names.length > 0 ? names.join(audit("common.listSeparator")) : "none");
  await recordAudit(
    { userId: user.id, label: user.label },
    "group.member.oidc",
    audit("audit.oidcGroups", {
      added: list(added.map(([, name]) => name)),
      removed: list(removed.map((m) => m.group.name)),
      created: list(created),
    }),
    { userId: user.id, added: added.map(([id]) => id), removed: removed.map((m) => m.groupId), created },
  );
}
