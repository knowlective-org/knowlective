import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createKnowledgeRoot, createPrismaClient } from "../src/index";

async function main() {
  const prisma = createPrismaClient();

  const user = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    create: { email: "demo@example.com", name: "Demo User", passwordHash: "unset" },
    update: {},
  });

  // Idempotent: the demo page (fixed id "demo", used by /pages/demo) marks
  // that the demo knowledge root already exists.
  if (await prisma.page.findUnique({ where: { id: "demo" }, select: { id: true } })) {
    console.log("Demo data already exists; nothing to do.");
    return;
  }

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
