import { HocuspocusProvider } from "@hocuspocus/provider";
import { expect, test } from "@playwright/test";
import { createCollabToken } from "shared";
import { COLLAB_CLIENT_VERSION } from "../src/lib/collab-version";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { ACCOUNTS, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { createPage, openPage, trashOpenPage } from "./helpers";
import { openAdmin } from "./admin-login";

// The collaboration server (/collab) talked to directly, as a client that
// doesn't go through the app's screens would: tokens that mustn't get in,
// edits from a read-only connection, and cursors claiming to be someone else.
// Tokens are signed here with the server key from the root .env (loaded by
// ./db), like getCollabToken does.

test.use({ storageState: authFile("admin") });

type Connection = { provider: HocuspocusProvider; doc: Y.Doc; result: Promise<"synced" | "refused"> };

function connect(baseURL: string, pageId: string, token: string): Connection {
  const url = new URL("collab", baseURL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const doc = new Y.Doc();
  let settle: (r: "synced" | "refused") => void = () => {};
  const result = new Promise<"synced" | "refused">((resolve) => (settle = resolve));
  const provider = new HocuspocusProvider({
    url: url.href,
    name: pageId,
    document: doc,
    token,
    WebSocketPolyfill: globalThis.WebSocket,
    onSynced: () => settle("synced"),
    onAuthenticationFailed: () => settle("refused"),
  } as ConstructorParameters<typeof HocuspocusProvider>[0]);
  return { provider, doc, result };
}

const V = COLLAB_CLIENT_VERSION;

const close = (...connections: Connection[]) => connections.forEach((c) => c.provider.destroy());
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function userIds() {
  return withPrisma(async (prisma) => {
    const id = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, email), select: { id: true } })).id;
    return { editor: await id(ACCOUNTS.editor.email), viewer: await id(ACCOUNTS.viewer.email), outsider: await id(ACCOUNTS.outsider.email) };
  });
}

// A raw Hocuspocus awareness message: the document's name, the message type
// (1 = awareness) and the encoded update, each with its varint prefix.
function awarenessMessage(documentName: string, update: Uint8Array): Uint8Array {
  const varuint = (n: number) => {
    const out: number[] = [];
    while (n > 0x7f) {
      out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(n);
    return out;
  };
  const name = new TextEncoder().encode(documentName);
  return Uint8Array.from([...varuint(name.length), ...name, ...varuint(1), ...varuint(update.length), ...update]);
}

test.describe("Collaboration server", () => {
  let pageId: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("admin") });
    const page = await context.newPage();
    ({ id: pageId } = await createPage(page, "E2E 共同編集の守り"));
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("admin") });
    const page = await context.newPage();
    await openPage(page, pageId);
    await trashOpenPage(page);
    await context.close();
  });

  test("tokens that aren't valid for this person and page are refused", async ({ baseURL }) => {
    const users = await userIds();
    const valid = connect(baseURL!, pageId, createCollabToken(users.editor, pageId, V));
    expect(await valid.result).toBe("synced");
    close(valid);

    const token = createCollabToken(users.editor, pageId, V);
    const refused = {
      // The signature doesn't match (one character changed).
      forged: token.slice(0, -2) + (token.at(-2) === "A" ? "B" : "A") + token.at(-1),
      expired: createCollabToken(users.editor, pageId, V, Date.now() - 10 * 60_000),
      // Signed for another page.
      otherPage: createCollabToken(users.editor, "e2e-home", V),
      // Not logged in (public pages are shown without collaborative editing).
      notLoggedIn: createCollabToken("", pageId, V),
      // Logged in, but no access to the page.
      noAccess: createCollabToken(users.outsider, pageId, V),
      // From an editor older than the app (it would drop blocks it doesn't
      // know, and ignore block locks).
      outdated: createCollabToken(users.editor, pageId, V - 1),
    };
    for (const [why, t] of Object.entries(refused)) {
      const c = connect(baseURL!, pageId, t);
      expect(await c.result, why).toBe("refused");
      close(c);
    }
  });

  test("a read-only connection's edits are dropped", async ({ baseURL }) => {
    const users = await userIds();
    const viewer = connect(baseURL!, pageId, createCollabToken(users.viewer, pageId, V));
    const editor = connect(baseURL!, pageId, createCollabToken(users.editor, pageId, V));
    expect(await viewer.result).toBe("synced");
    expect(await editor.result).toBe("synced");
    const before = editor.doc.getText("title").toString();

    viewer.doc.getText("title").insert(0, "閲覧者が書いた");
    await pause(1500);
    expect(editor.doc.getText("title").toString()).toBe(before);

    // An editor's change does arrive (so the check above means something).
    editor.doc.getText("title").insert(0, "編集者が書いた");
    await expect.poll(() => viewer.doc.getText("title").toString()).toContain("編集者が書いた");
    close(viewer, editor);
  });

  // Access is checked when an editor connects: one already open must be
  // closed when its person loses access, or they'd keep reading and editing.
  // This client ignores the server's notice, as a tampered one could.
  test("someone taken out of a group loses an editor they have open", async ({ baseURL, page }) => {
    const users = await userIds();
    const groupId = await withPrisma(async (prisma) => {
      const group = await prisma.group.create({ data: { name: `E2E 接続を切る ${Date.now()}` } });
      await prisma.groupMember.create({ data: { groupId: group.id, userId: users.outsider } });
      await prisma.pageGrant.create({ data: { pageId, groupId: group.id, access: "EDIT" } });
      return group.id;
    });
    try {
      const outsider = connect(baseURL!, pageId, createCollabToken(users.outsider, pageId, V));
      const editor = connect(baseURL!, pageId, createCollabToken(users.editor, pageId, V));
      expect(await outsider.result).toBe("synced");
      expect(await editor.result).toBe("synced");
      // While in the group, their edits arrive.
      outsider.doc.getText("title").insert(0, "グループにいる間");
      await expect.poll(() => editor.doc.getText("title").toString()).toContain("グループにいる間");

      await openAdmin(page, `/groups/${groupId}`);
      const row = page.locator(`[data-ui="AdminGroupPage.memberRow"][data-id="${users.outsider}"]`);
      const remove = page.getByTestId("RowMenu.item").filter({ hasText: "グループから外す" });
      await expect(async () => {
        await row.getByTestId("RowMenu.toggle").click();
        await expect(remove).toBeVisible({ timeout: 2000 });
      }).toPass();
      await remove.click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await expect.poll(() => withPrisma((prisma) => prisma.groupMember.count({ where: { groupId } }))).toBe(0);

      // Out of the group: nothing they write gets through any more.
      await pause(1000);
      outsider.doc.getText("title").insert(0, "外された後");
      await pause(2000);
      expect(editor.doc.getText("title").toString()).not.toContain("外された後");
      close(outsider, editor);
    } finally {
      await withPrisma((prisma) => prisma.group.delete({ where: { id: groupId } }));
    }
  });

  test("cursors carry the logged-in person's name, and nobody can speak for another's cursor", async ({ baseURL }) => {
    const users = await userIds();
    const viewer = connect(baseURL!, pageId, createCollabToken(users.viewer, pageId, V));
    const editor = connect(baseURL!, pageId, createCollabToken(users.editor, pageId, V));
    expect(await viewer.result).toBe("synced");
    expect(await editor.result).toBe("synced");
    viewer.provider.setAwarenessField("user", { name: "E2E 閲覧者", color: "#000000" });

    // The editor claims another name: others see the real one.
    editor.provider.setAwarenessField("user", { name: "偽の名前", color: "#000000" });
    const seenByViewer = () => (viewer.provider.awareness!.getStates().get(editor.doc.clientID) as { user?: { name?: string } } | undefined)?.user?.name;
    await expect.poll(seenByViewer).toBe("E2E 編集者");

    // The editor sends a cursor for the viewer's client: it never arrives.
    const fake = new Awareness(new Y.Doc());
    const states = new Map([[viewer.doc.clientID, { user: { name: "乗っ取り", color: "#000000" } }]]);
    fake.meta.set(viewer.doc.clientID, { clock: 100_000, lastUpdated: Date.now() });
    const update = encodeAwarenessUpdate(fake, [viewer.doc.clientID], states);
    const socket = (editor.provider.configuration as unknown as { websocketProvider: { webSocket: WebSocket | null } }).websocketProvider.webSocket;
    socket!.send(awarenessMessage(pageId, update));
    await pause(1500);
    const viewerSeenByEditor = (editor.provider.awareness!.getStates().get(viewer.doc.clientID) as { user?: { name?: string } } | undefined)?.user?.name;
    expect(viewerSeenByEditor).toBe("E2E 閲覧者");
    close(viewer, editor);
  });
});
