import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createKnowledgeRoot, createPrismaClient, ensurePersonalRoot } from "../src/index";

const DEMO_USER_ID = "demo-user";

async function main() {
  const prisma = createPrismaClient();

  // Idempotent: the demo page (fixed id "demo", used by /pages/demo) marks
  // that the demo data already exists.
  if (await prisma.page.findUnique({ where: { id: "demo" }, select: { id: true } })) {
    console.log("Demo data already exists; nothing to do.");
    return;
  }

  // Owns the demo pages; can't sign in, and has no email address (this runs
  // before setup, when there is no data key to encrypt one with).
  const user = await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    create: { id: DEMO_USER_ID, name: "Demo User", passwordHash: "unset" },
    update: {},
  });
  await prisma.$transaction((tx) => ensurePersonalRoot(tx, user.id));

  await prisma.$transaction(async (tx) => {
    const { rootId, rootPageId } = await createKnowledgeRoot(tx, {
      title: "Demo",
      createdById: user.id,
    });
    // Page access only comes from group grants.
    const group = await tx.group.upsert({
      where: { name: "Demo 管理" },
      create: { name: "Demo 管理", description: "デモのナレッジルートを管理するグループ" },
      update: {},
    });
    await tx.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id },
      update: {},
    });
    await tx.pageGrant.create({ data: { pageId: rootPageId, groupId: group.id, access: "MANAGE" } });
    await tx.page.create({
      data: { id: "demo", title: "Demo Page", rootId, parentId: rootPageId, createdById: user.id },
    });
  });

  console.log("Seeded demo user, knowledge root, and page.");
}

main();
