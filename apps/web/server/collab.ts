import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus, type Extension } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import crossws from "crossws/adapters/node";
import {
  atLeast,
  createPrismaClient,
  getPageAccess,
  decrypt,
  encrypt,
  isSetupComplete,
  loadDataKey,
  verifyCollabToken,
} from "shared";
import { TITLE_FIELD, normalizeTitle } from "../src/lib/page-title";
import { CHILDREN_CHANGED, PAGE_DELETED, notifyChildrenChanged, registerCollabBridge } from "../src/lib/collab-events";

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

  // Last user whose update changed each document since it was last stored.
  // Server-side changes (the title seed) have no connection context.
  const editedBy = new Map<string, string>();

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
        // Mirror the live title into Page.title (sidebar, home, root name),
        // and record who last edited (child-page table's 更新日時 / 更新者).
        const title = normalizeTitle(document.getText(TITLE_FIELD).toString());
        const editorId = editedBy.get(documentName);
        editedBy.delete(documentName);
        const page = await prisma.page.findUnique({ where: { id: documentName }, select: { title: true, parentId: true } });
        if (!page || (page.title === title && !editorId)) return;
        await prisma.page.update({
          where: { id: documentName },
          data: { title, ...(editorId && { updatedById: editorId, updatedAt: new Date() }) },
        });
        notifyChildrenChanged(page.parentId);
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
    // logged-in user and a single page. Access is re-checked here (group
    // grants, disabled account) so a revoked grant takes effect on the next
    // connection, not when the token expires.
    async onAuthenticate({ token, documentName, connectionConfig }) {
      // Without setup there is no data key, so nothing could be loaded or saved.
      if (!(await isSetupComplete(prisma))) {
        throw new Error("Instance setup has not been completed");
      }
      const payload = verifyCollabToken(token ?? "");
      if (!payload || payload.p !== documentName) {
        throw new Error("Invalid collab token");
      }
      const result = await getPageAccess(prisma, payload.u, documentName);
      if (!result) {
        throw new Error("No access to this page");
      }
      // VIEW: the server drops any update this connection sends.
      if (!atLeast(result.access, "EDIT")) {
        connectionConfig.readOnly = true;
      }
      return { userId: payload.u };
    },
    async onChange({ documentName, context }) {
      const userId = (context as { userId?: string } | undefined)?.userId;
      if (userId) editedBy.set(documentName, userId);
    },
  });

  // Server Actions reach the running instance through this bridge
  // (src/lib/collab-events.ts). The message carries no data: clients refetch.
  registerCollabBridge({
    notifyChildrenChanged(parentPageId) {
      const payload = JSON.stringify({ type: CHILDREN_CHANGED });
      const document = hocuspocus.documents.get(parentPageId);
      if (document) {
        // With Redis, the beforeBroadcastStateless hook relays it to other instances.
        document.broadcastStateless(payload);
        return;
      }
      // Not open here, but may be open on another instance.
      if (!process.env.REDIS_URL) return;
      void hocuspocus
        .openDirectConnection(parentPageId)
        .then(async (connection) => {
          connection.document?.broadcastStateless(payload);
          await connection.disconnect();
        })
        .catch((err) => console.error("[collab] notify failed", err));
    },
    // Only this instance's connections; with Redis, other instances keep
    // theirs until they reconnect (access is re-checked then).
    closeDocuments(pageIds) {
      for (const id of pageIds) {
        const document = hocuspocus.documents.get(id);
        if (!document) continue;
        document.broadcastStateless(JSON.stringify({ type: PAGE_DELETED }));
        hocuspocus.closeConnections(id);
      }
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
