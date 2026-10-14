import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createKnowledgeRoot, createPrismaClient, encrypt, hashPassword, loadDataKey } from "../src/index";

// Test accounts and a knowledge root for the end-to-end tests
// (apps/web/e2e). Safe to run again: it resets the accounts' passwords, roles
// and two-step state, and leaves the pages the tests have made.
//   pnpm e2e:seed
//
// The credentials are fixed and public (they are in this file), so this must
// never run against a real instance.

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
  if (process.env.NODE_ENV === "production" && process.env.YOSUGA_E2E_SEED !== "1") {
    throw new Error("e2e:seed creates accounts with public passwords; refusing to run in production.");
  }
  const prisma = createPrismaClient();
  const dataKey = await loadDataKey(prisma);
  const passwordHash = await hashPassword(PASSWORD);

  const users = new Map<string, string>();
  for (const u of USERS) {
    // rootOrder: the sidebar starts in creation order on every run.
    const base = { name: u.name, passwordHash, siteRole: u.siteRole, disabledAt: null, rootOrder: [] };
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, ...base },
      update: base,
      select: { id: true },
    });
    users.set(u.email, user.id);
    // The admin signs in to /admin with a code from this secret; the others
    // have no authenticator. A used code can't be used again, so the last
    // accepted step is cleared too.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret:
          u.siteRole === "SITE_ADMIN"
            ? Uint8Array.from(encrypt(dataKey, ADMIN_TOTP_SECRET, `yosuga:user-totp:${user.id}`))
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

  // Earlier runs' failed sign-ins must not lock this one out.
  await prisma.adminLoginAttempt.deleteMany({ where: { email: { in: USERS.map((u) => u.email) } } });
  await prisma.userLoginAttempt.deleteMany({ where: { email: { in: USERS.map((u) => u.email) } } });

  console.log(`Seeded ${USERS.length} E2E accounts, ${GROUPS.length} groups and the E2E knowledge roots.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
