import path from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { Server, Extension } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import {
  createPrismaClient,
  decrypt,
  encrypt,
  isSetupComplete,
  loadDataKey,
  verifyCollabToken,
} from "shared";

const prisma = createPrismaClient();

// Page content is encrypted at rest with the instance data key. The pageId is
// bound as AAD so a ciphertext can't be copied onto a different page's row.
const extensions: Extension[] = [
  new Database({
    fetch: async ({ documentName }) => {
      const doc = await prisma.pageDocument.findUnique({
        where: { pageId: documentName },
      });
      if (!doc) return null;
      return decrypt(await loadDataKey(prisma), doc.state, documentName);
    },
    store: async ({ documentName, state }) => {
      const bytes = Uint8Array.from(encrypt(await loadDataKey(prisma), state, documentName));
      await prisma.pageDocument.upsert({
        where: { pageId: documentName },
        create: { pageId: documentName, state: bytes },
        update: { state: bytes },
      });
    },
  }),
];

// Enables horizontal scaling across multiple collab server instances.
// Skipped when REDIS_URL isn't set (e.g. local single-instance dev).
if (process.env.REDIS_URL) {
  extensions.push(
    new Redis({
      host: new URL(process.env.REDIS_URL).hostname,
      port: Number(new URL(process.env.REDIS_URL).port || 6379),
    }),
  );
}

const server = new Server({
  port: Number(process.env.COLLAB_PORT ?? 1234),
  extensions,
  // The token is minted by apps/web (getCollabToken) for a logged-in user and
  // a single page. Membership is re-checked here so removal from a workspace
  // takes effect on the next connection, not when the token expires.
  async onAuthenticate({ token, documentName, connectionConfig }) {
    // Without setup there is no data key, so nothing could be loaded or saved.
    if (!(await isSetupComplete(prisma))) {
      throw new Error("Instance setup has not been completed");
    }
    const payload = verifyCollabToken(token ?? "");
    if (!payload || payload.p !== documentName) {
      throw new Error("Invalid collab token");
    }
    const member = await prisma.workspaceMember.findFirst({
      where: {
        userId: payload.u,
        workspace: { pages: { some: { id: documentName, deletedAt: null } } },
      },
      select: { role: true },
    });
    if (!member) {
      throw new Error("Not a member of this page's workspace");
    }
    if (member.role === "GUEST") {
      connectionConfig.readOnly = true;
    }
    return { userId: payload.u };
  },
});

// Fail fast on a missing or mismatched YOSUGA_SERVER_KEY instead of erroring
// on the first document load. Before setup there is no key to check yet.
async function start() {
  if (await isSetupComplete(prisma)) {
    await loadDataKey(prisma);
  }
  await server.listen();
}

start().then(() => {
  console.log(`[collab] Hocuspocus server listening on port ${server.configuration.port}`);
});
