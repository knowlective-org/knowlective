import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createPrismaClient } from "../src/index";

async function main() {
  const prisma = createPrismaClient();

  const user = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    create: { email: "demo@example.com", name: "Demo User", passwordHash: "unset" },
    update: {},
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo" },
    create: {
      name: "Demo Workspace",
      slug: "demo",
      members: { create: { userId: user.id, role: "OWNER" } },
    },
    update: {},
  });

  // Fixed id "demo" so the /pages/demo BlockNote + Yjs collaboration demo has
  // a real Page row to satisfy PageDocument's foreign key.
  await prisma.page.upsert({
    where: { id: "demo" },
    create: {
      id: "demo",
      title: "Demo Page",
      workspaceId: workspace.id,
      createdById: user.id,
    },
    update: {},
  });

  console.log("Seeded demo user, workspace, and page.");
}

main();
