import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus, type Extension } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import crossws from "crossws/adapters/node";
import * as Y from "yjs";
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
import { VERSION_INTERVAL_MS, versionAad, type PageVersionKind } from "../src/lib/page-versions";
import { reindexPage, reindexStalePages } from "../src/lib/search-index";

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
  // Users who edited each document since its last saved version (履歴).
  const pendingEditors = new Map<string, Set<string>>();

  // Saves the document's current state as a version of the page.
  async function saveVersion(
    pageId: string,
    document: Y.Doc,
    kind: PageVersionKind,
    editorIds: string[],
    restoredFromId?: string,
  ) {
    const id = randomUUID();
    const state = Y.encodeStateAsUpdate(document);
    await prisma.pageVersion.create({
      data: {
        id,
        pageId,
        kind,
        title: normalizeTitle(document.getText(TITLE_FIELD).toString()),
        editorIds,
        state: Uint8Array.from(encrypt(await loadDataKey(prisma), state, versionAad(pageId, id))),
        restoredFromId,
      },
    });
  }

  // A version for edits not yet in one, if the last version is old enough
  // (or `force`, e.g. everyone left). Never fails the caller.
  async function maybeSaveVersion(pageId: string, document: Y.Doc, force: boolean) {
    const editors = pendingEditors.get(pageId);
    if (!editors?.size) return;
    try {
      if (!force) {
        const last = await prisma.pageVersion.findFirst({
          where: { pageId },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (last && Date.now() - last.createdAt.getTime() < VERSION_INTERVAL_MS) return;
      }
      pendingEditors.delete(pageId);
      await saveVersion(pageId, document, "AUTO", [...editors]);
    } catch (err) {
      console.error("[collab] saving a page version failed", err);
    }
  }

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
        // Search index (title, body, attachment names) from the state just stored.
        await reindexPage(prisma, documentName, Uint8Array.from(state));
        if (!page || (page.title === title && !editorId)) return;
        await prisma.page.update({
          where: { id: documentName },
          data: { title, ...(editorId && { updatedById: editorId, updatedAt: new Date() }) },
        });
        notifyChildrenChanged(page.parentId);
        await maybeSaveVersion(documentName, document, false);
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
      // Pages edited before history existed: keep the state found now as the
      // first version, so the earliest edits can still be undone.
      const hasContent = document.getXmlFragment("blocknote").length > 0;
      if (hasContent && (await prisma.pageVersion.count({ where: { pageId: documentName } })) === 0) {
        await saveVersion(documentName, document, "INITIAL", []).catch((err) =>
          console.error("[collab] saving the initial page version failed", err),
        );
      }
      const text = document.getText(TITLE_FIELD);
      if (text.length > 0) return;
      const page = await prisma.page.findUnique({ where: { id: documentName }, select: { title: true } });
      if (page?.title && text.length === 0) text.insert(0, page.title);
    },
    // Everyone has left: whatever was edited since the last version becomes one.
    async beforeUnloadDocument({ document, documentName }) {
      await maybeSaveVersion(documentName, document, true);
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
      if (!userId) return;
      editedBy.set(documentName, userId);
      const editors = pendingEditors.get(documentName) ?? new Set<string>();
      editors.add(userId);
      pendingEditors.set(documentName, editors);
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
    liveState(pageId) {
      const document = hocuspocus.documents.get(pageId);
      return document ? Y.encodeStateAsUpdate(document) : null;
    },
    // Replaces the page's title and body with a saved version, through the
    // live document so everyone editing sees it (and it merges like any
    // edit). The state just before is saved first, so a restore can itself
    // be undone. Access is checked by the caller.
    async restoreVersion(pageId, versionId, userId) {
      const version = await prisma.pageVersion.findUnique({ where: { id: versionId } });
      if (!version || version.pageId !== pageId) throw new Error("Version not found");
      const snapshot = new Y.Doc();
      Y.applyUpdate(snapshot, decrypt(await loadDataKey(prisma), version.state, versionAad(pageId, versionId)));

      const connection = await hocuspocus.openDirectConnection(pageId, { userId });
      try {
        const document = connection.document!;
        const before = pendingEditors.get(pageId);
        pendingEditors.delete(pageId);
        await saveVersion(pageId, document, "BEFORE_RESTORE", [...(before ?? [])]);
        await connection.transact((doc) => {
          const fragment = doc.getXmlFragment("blocknote");
          fragment.delete(0, fragment.length);
          fragment.insert(
            0,
            snapshot
              .getXmlFragment("blocknote")
              .toArray()
              .map((node) => (node as Y.XmlElement | Y.XmlText).clone()),
          );
          const title = doc.getText(TITLE_FIELD);
          title.delete(0, title.length);
          title.insert(0, snapshot.getText(TITLE_FIELD).toString());
        });
        await saveVersion(pageId, document, "RESTORED", [userId], versionId);
        // The restore itself is in the RESTORED version.
        pendingEditors.delete(pageId);
      } finally {
        await connection.disconnect();
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
    // Catch up the search index (pages edited before it existed, or while
    // indexing failed) without delaying startup.
    void reindexStalePages(prisma)
      .then((n) => n > 0 && console.log(`[search] indexed ${n} page(s)`))
      .catch((err) => console.error("[search] catching up the index failed", err));
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
