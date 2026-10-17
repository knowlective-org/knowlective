import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createPrismaClient, generateKey, rewrapWithServerKey } from "../src/index";
import { promptHidden } from "./prompt";

// Issues a new KNOWLECTIVE_SERVER_KEY, using the master password to re-wrap the
// data encryption key. Use when the server key is lost, leaked, or rotated.
//   pnpm rotate-server-key

async function main() {
  const prisma = createPrismaClient();
  const masterPassword = await promptHidden("Master password: ");
  const newServerKey = generateKey();
  await rewrapWithServerKey(prisma, masterPassword, newServerKey);

  console.log("\nThe data encryption key is now wrapped with a new server key.");
  console.log("Replace KNOWLECTIVE_SERVER_KEY in .env, then restart the app:\n");
  console.log(`KNOWLECTIVE_SERVER_KEY="${newServerKey.toString("base64")}"`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
