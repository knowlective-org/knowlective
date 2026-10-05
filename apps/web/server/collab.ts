import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus, type Extension } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import crossws from "crossws/adapters/node";
import {
  createPrismaClient,
  decrypt,
  encrypt,
  isSetupComplete,
  loadDataKey,
  verifyCollabToken,
} from "shared";
import { TITLE_FIELD, normalizeTitle } from "../src/lib/page-title";

// Real-time collaboration (Yjs over WebSocket), served by the same process
// and port as the Next.js app at COLLAB_PATH. server/index.ts routes the
// HTTP upgrade here; everything else (including Next's dev HMR socket) goes
// to Next.js.

export const COLLAB_PATH = "/collab";

type ClientConnection = ReturnType<Hocuspocus["handleConnection"]>;

export async function createCollab() {
  // Separate from the app's PrismaClient (src/lib/db.ts): this module is
  // loaded by the custom server, not bundled by Next.js.
  const prisma = createPrismaClient();

  // Page content is encrypted at rest with the instance data key. The pageId
  // is bound as AAD so a ciphertext can't be copied onto a different page's row.
  const extensions: Extension[] = [
    new Database({
      fetch: async ({ documentName }) => {
        const doc = await prisma.pageDocument.findUnique({ where: { pageId: documentName } });
        if (!doc) return null;
        return decrypt(await loadDataKey(prisma), doc.state, documentName);
      },
      store: async ({ documentName, state, document }) => {
        const bytes = Uint8Array.from(encrypt(await loadDataKey(prisma), state, documentName));
        await prisma.pageDocument.upsert({
          where: { pageId: documentName },
          create: { pageId: documentName, state: bytes },
          update: { state: bytes },
        });
        // Mirror the live title into Page.title (sidebar, home, root name).
        const title = normalizeTitle(document.getText(TITLE_FIELD).toString());
        await prisma.page.updateMany({
          where: { id: documentName, NOT: { title } },
          data: { title },
        });
      },
    }),
  ];

  // Lets several app instances share documents (horizontal scaling).
  // Skipped when REDIS_URL isn't set (e.g. local single-instance dev).
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    extensions.push(new Redis({ host: url.hostname, port: Number(url.port || 6379) }));
  }

  const hocuspocus = new Hocuspocus({
    extensions,
    quiet: true,
    // Documents saved before titles lived in Yjs (or never opened yet) have
    // no title text: seed it from Page.title once, on the server, so clients
    // never race to insert it twice.
    async afterLoadDocument({ document, documentName }) {
      const text = document.getText(TITLE_FIELD);
      if (text.length > 0) return;
      const page = await prisma.page.findUnique({ where: { id: documentName }, select: { title: true } });
      if (page?.title && text.length === 0) text.insert(0, page.title);
    },
    // The token is minted by getCollabToken (src/app/(app)/actions.ts) for a
    // logged-in user and a single page. Membership is re-checked here so
    // removal from a knowledge root takes effect on the next connection, not when
    // the token expires.
    async onAuthenticate({ token, documentName, connectionConfig }) {
      // Without setup there is no data key, so nothing could be loaded or saved.
      if (!(await isSetupComplete(prisma))) {
        throw new Error("Instance setup has not been completed");
      }
      const payload = verifyCollabToken(token ?? "");
      if (!payload || payload.p !== documentName) {
        throw new Error("Invalid collab token");
      }
      const member = await prisma.knowledgeRootMember.findFirst({
        where: {
          userId: payload.u,
          user: { disabledAt: null },
          root: { pages: { some: { id: documentName, deletedAt: null } } },
        },
        select: { role: true },
      });
      if (!member) {
        throw new Error("Not a member of this page's knowledge root");
      }
      if (member.role === "GUEST") {
        connectionConfig.readOnly = true;
      }
      return { userId: payload.u };
    },
  });

  // Same wiring as @hocuspocus/server's own Server class, minus its HTTP server.
  const connections = new WeakMap<object, ClientConnection>();
  const ws = crossws({
    serverOptions: { maxPayload: 32 * 1024 * 1024 },
    hooks: {
      open(peer) {
        connections.set(peer, hocuspocus.handleConnection(peer.websocket as WebSocket, peer.request as Request));
      },
      message(peer, message) {
        connections.get(peer)?.handleMessage(message.uint8Array());
      },
      close(peer, event) {
        connections.get(peer)?.handleClose({ code: event.code ?? 1000, reason: event.reason ?? "" });
      },
      error(peer, error) {
        console.error("[collab] WebSocket error for peer", peer.id, error);
      },
    },
  });

  // Fail fast on a missing or mismatched YOSUGA_SERVER_KEY instead of erroring
  // on the first document load. Before setup there is no key to check yet.
  if (await isSetupComplete(prisma)) {
    await loadDataKey(prisma);
  }

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      return ws.handleUpgrade(req, socket, head);
    },

    // Persist pending edits and close connections before the process exits.
    async shutdown(timeoutMs = 10_000) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        hocuspocus.configuration.extensions.push({
          async afterUnloadDocument({ instance }) {
            if (instance.getDocumentsCount() === 0) {
              clearTimeout(timer);
              resolve();
            }
          },
        });
        if (hocuspocus.getDocumentsCount() === 0) {
          clearTimeout(timer);
          resolve();
          return;
        }
        hocuspocus.closeConnections();
        hocuspocus.flushPendingStores();
      });
      await prisma.$disconnect();
    },
  };
}
