import { randomBytes } from "node:crypto";
import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import {
  createKnowledgeRoot,
  createPrismaClient,
  emailHash,
  encrypt,
  encryptLegacyPersonalData,
  ensurePersonalRoot,
  hashPassword,
  isSetupComplete,
  loadDataKey,
  sealEmail,
  setupInstance,
} from "../src/index";

// Test accounts and a knowledge root for the end-to-end tests
// (apps/web/e2e). Safe to run again: it resets the accounts' passwords, roles
// and two-step state, and leaves the pages the tests have made.
//   pnpm e2e:seed
//
// The credentials are fixed and public (they are in this file), so this must
// never run against a real instance.
//
// KNOWLECTIVE_E2E_SETUP=1: if the database isn't set up yet (a fresh one, as
// in CI), set it up first (otherwise the seed needs a set-up instance).

// Keep in sync with apps/web/e2e/accounts.ts.
const PASSWORD = "e2e-Password-2026";
// The admin's authenticator secret (20 bytes, "e2e-totp-secret-1234").
const ADMIN_TOTP_SECRET = Buffer.from("e2e-totp-secret-1234", "utf8");
const HOME_PAGE_ID = "e2e-home";
const SECOND_HOME_PAGE_ID = "e2e-second-home";

const USERS = [
  { email: "e2e-admin@example.com", name: "E2E 管理者", siteRole: "SITE_ADMIN", group: "E2E 管理" },
  { email: "e2e-editor@example.com", name: "E2E 編集者", siteRole: "USER", group: "E2E 編集" },
  { email: "e2e-viewer@example.com", name: "E2E 閲覧者", siteRole: "USER", group: "E2E 閲覧" },
  // In no group: sees none of the test pages.
  { email: "e2e-outsider@example.com", name: "E2E 部外者", siteRole: "USER", group: null },
] as const;

const GROUPS = [
  { name: "E2E 管理", access: "MANAGE" },
  { name: "E2E 編集", access: "EDIT" },
  { name: "E2E 閲覧", access: "VIEW" },
] as const;

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.KNOWLECTIVE_E2E_SEED !== "1") {
    throw new Error("e2e:seed creates accounts with public passwords; refusing to run in production.");
  }
  const prisma = createPrismaClient();
  // A fresh database (CI) is set up first: an unknown master password (the
  // tests never use it) and the address the tests reach the server at.
  if (process.env.KNOWLECTIVE_E2E_SETUP === "1" && !(await isSetupComplete(prisma))) {
    const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
    await setupInstance(prisma, randomBytes(24).toString("base64url"), origin, "ja");
    console.log(`e2e:seed: set up the instance (${origin})`);
  }
  const dataKey = await loadDataKey(prisma);
  const passwordHash = await hashPassword(PASSWORD);
  // Accounts from before email encryption would otherwise be made again
  // (the server does this at startup too; the seed may run first).
  await encryptLegacyPersonalData(prisma, dataKey);

  const users = new Map<string, string>();
  for (const u of USERS) {
    // rootOrder: the sidebar starts in creation order on every run.
    const base = { name: u.name, passwordHash, siteRole: u.siteRole, disabledAt: null, rootOrder: [] };
    const email = sealEmail(dataKey, u.email);
    const user = await prisma.user.upsert({
      where: { emailHash: email.emailHash },
      create: { ...email, ...base },
      update: base,
      select: { id: true },
    });
    users.set(u.email, user.id);
    // A person's account comes with a personal knowledge root.
    await prisma.$transaction((tx) => ensurePersonalRoot(tx, user.id, "マイページ"));
    // The admin signs in to /admin with a code from this secret; the others
    // have no authenticator. A used code can't be used again, so the last
    // accepted step is cleared too.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret:
          u.siteRole === "SITE_ADMIN"
            ? Uint8Array.from(encrypt(dataKey, ADMIN_TOTP_SECRET, `knowlective:user-totp:${user.id}`))
            : null,
        totpLastStep: null,
      },
    });
  }

  const groups = new Map<string, string>();
  for (const g of GROUPS) {
    const group = await prisma.group.upsert({
      where: { name: g.name },
      create: { name: g.name, description: "E2E テスト用" },
      update: {},
      select: { id: true },
    });
    groups.set(g.name, group.id);
  }
  for (const u of USERS) {
    if (!u.group) continue;
    const key = { groupId: groups.get(u.group)!, userId: users.get(u.email)! };
    await prisma.groupMember.upsert({ where: { groupId_userId: key }, create: key, update: {} });
  }

  // The fixed-id page marks that the knowledge root already exists.
  if (!(await prisma.page.findUnique({ where: { id: HOME_PAGE_ID }, select: { id: true } }))) {
    const adminId = users.get("e2e-admin@example.com")!;
    await prisma.$transaction(async (tx) => {
      const { rootId, rootPageId } = await createKnowledgeRoot(tx, { title: "E2E", createdById: adminId });
      for (const g of GROUPS) {
        await tx.pageGrant.create({ data: { pageId: rootPageId, groupId: groups.get(g.name)!, access: g.access } });
      }
      await tx.page.create({
        data: { id: HOME_PAGE_ID, title: "E2E ホーム", rootId, parentId: rootPageId, createdById: adminId },
      });
    });
  }
  // A second knowledge root with the same access, made after the first, so
  // there is an order of roots to change (the sidebar reordering test).
  if (!(await prisma.page.findUnique({ where: { id: SECOND_HOME_PAGE_ID }, select: { id: true } }))) {
    const adminId = users.get("e2e-admin@example.com")!;
    await prisma.$transaction(async (tx) => {
      const { rootId, rootPageId } = await createKnowledgeRoot(tx, { title: "E2E サブ", createdById: adminId });
      for (const g of GROUPS) {
        await tx.pageGrant.create({ data: { pageId: rootPageId, groupId: groups.get(g.name)!, access: g.access } });
      }
      await tx.page.create({
        data: { id: SECOND_HOME_PAGE_ID, title: "E2E サブのホーム", rootId, parentId: rootPageId, createdById: adminId },
      });
    });
  }

  // Restored if a test (or a person) moved it to the trash.
  await prisma.page.update({ where: { id: HOME_PAGE_ID }, data: { deletedAt: null, deletedById: null } });
  // Pages tests made under it and didn't get to put in the trash (a run that
  // failed partway): to the trash now, so they don't pile up in the sidebar
  // (and push other roots out of reach of the tests that drag them).
  await prisma.page.updateMany({ where: { parentId: HOME_PAGE_ID, deletedAt: null }, data: { deletedAt: new Date() } });

  // Earlier runs' failed sign-ins must not lock this one out.
  const hashes = USERS.map((u) => emailHash(dataKey, u.email));
  await prisma.adminLoginAttempt.deleteMany({ where: { emailHash: { in: hashes } } });
  await prisma.userLoginAttempt.deleteMany({ where: { emailHash: { in: hashes } } });

  console.log(`Seeded ${USERS.length} E2E accounts, ${GROUPS.length} groups and the E2E knowledge roots.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
