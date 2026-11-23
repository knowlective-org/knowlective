import { createHash, randomBytes } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { PUBLIC_GROUP, loadDataKey } from "shared";
import { captureSnapshot, openSnapshot } from "../src/lib/presentation-history";
import { ACCOUNTS, HOME_PAGE_ID, type Role, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";

// A presentation over the public API, and what someone not logged in can get
// of a public one. Keys are put straight in the database (issuing one on
// the account screen is covered by api.spec.ts) and removed afterwards.

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const keyIds: string[] = [];
const createdPages: string[] = [];
let settings: { apiEnabled: boolean; apiKeyRoles: string[]; publicPagesAllowed: boolean };

async function keyFor(role: Role, scope: "READ" | "WRITE"): Promise<string> {
  const key = `kn_${randomBytes(32).toString("base64url")}`;
  await withPrisma(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS[role].email), select: { id: true } });
    const row = await prisma.apiKey.create({
      data: {
        userId: user.id,
        tokenHash: createHash("sha256").update(key).digest("hex"),
        prefix: key.slice(0, 8),
        nameEnc: Uint8Array.from(randomBytes(16)),
        scope,
      },
      select: { id: true },
    });
    keyIds.push(row.id);
  });
  return key;
}

const api = (request: APIRequestContext, key: string) => {
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    get: (path: string) => request.get(`api/v1/${path}`, { headers }),
    post: (path: string, data: unknown = {}) => request.post(`api/v1/${path}`, { headers, data }),
    patch: (path: string, data: unknown) => request.patch(`api/v1/${path}`, { headers, data }),
    delete: (path: string) => request.delete(`api/v1/${path}`, { headers }),
  };
};

async function createDeck(client: ReturnType<typeof api>, title: string): Promise<string> {
  const res = await client.post("pages", { parentId: HOME_PAGE_ID, kind: "PRESENTATION", title });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  createdPages.push(id);
  return id;
}

const slidesOf = async (client: ReturnType<typeof api>, id: string) =>
  ((await (await client.get(`pages/${id}/slides`)).json()) as { slides: { id: string; number: number | null; hidden: boolean }[] }).slides;

test.describe("Presentation access", () => {
  test.beforeAll(async () => {
    await withPrisma(async (prisma) => {
      settings = await prisma.instanceConfig.findUniqueOrThrow({
        where: { id: 1 },
        select: { apiEnabled: true, apiKeyRoles: true, publicPagesAllowed: true },
      });
      await prisma.instanceConfig.update({
        where: { id: 1 },
        data: { apiEnabled: true, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"], publicPagesAllowed: true },
      });
    });
  });

  test.afterAll(async () => {
    await withPrisma(async (prisma) => {
      await prisma.apiKey.deleteMany({ where: { id: { in: keyIds } } });
      await prisma.page.updateMany({ where: { id: { in: createdPages } }, data: { deletedAt: new Date(), lockedAt: null } });
      await prisma.pageGrant.deleteMany({ where: { pageId: { in: createdPages }, group: { builtIn: PUBLIC_GROUP } } });
      await prisma.instanceConfig.update({
        where: { id: 1 },
        data: { ...settings, apiKeyRoles: settings.apiKeyRoles as never },
      });
    });
  });

  test("the API changes slides with the same checks as the screen", async ({ request }) => {
    const editor = api(request, await keyFor("editor", "WRITE"));
    const viewer = api(request, await keyFor("viewer", "WRITE"));
    const outsider = api(request, await keyFor("outsider", "READ"));
    const id = await createDeck(editor, `E2E API プレゼン ${Date.now()}`);

    const [first] = await slidesOf(editor, id);
    const added = await editor.post(`pages/${id}/slides`);
    expect(added.status()).toBe(201);
    const second = ((await added.json()) as { id: string }).id;
    expect((await slidesOf(editor, id)).map((s) => s.id)).toEqual([first.id, second]);

    // Content goes through the slide's board.
    const board = await editor.post(`pages/${second}/whiteboard`, { add: [{ type: "sticky", x: 100, y: 100, text: "API の付箋" }] });
    expect(board.status()).toBe(200);
    const items = (await (await editor.get(`pages/${second}/whiteboard`)).json()) as { items: { text?: string }[] };
    expect(items.items.map((i) => i.text)).toContain("API の付箋");

    expect((await editor.patch(`pages/${id}/slides/${second}`, { beforeId: first.id })).status()).toBe(200);
    expect((await slidesOf(editor, id)).map((s) => s.id)).toEqual([second, first.id]);
    expect((await editor.patch(`pages/${id}/slides/${second}`, { hidden: true })).status()).toBe(200);
    expect((await slidesOf(editor, id)).find((s) => s.id === second)?.hidden).toBe(true);

    // A slide isn't listed as a page.
    const listed = (await (await editor.get("pages")).json()) as { pages: { id: string }[] };
    expect(listed.pages.map((p) => p.id)).toContain(id);
    expect(listed.pages.map((p) => p.id)).not.toContain(first.id);

    // View access reads and changes nothing; no access sees nothing.
    expect((await viewer.get(`pages/${id}/slides`)).status()).toBe(200);
    expect((await viewer.post(`pages/${id}/slides`)).status()).toBe(403);
    expect((await viewer.patch(`pages/${id}/slides/${first.id}`, { hidden: true })).status()).toBe(403);
    expect((await viewer.delete(`pages/${id}/slides/${first.id}`)).status()).toBe(403);
    expect((await outsider.get(`pages/${id}/slides`)).status()).toBe(404);

    // A lock on the presentation keeps its slides as they are.
    await withPrisma((prisma) => prisma.page.update({ where: { id }, data: { lockedAt: new Date(), lockSubtree: false } }));
    expect((await editor.post(`pages/${id}/slides`)).status()).toBe(423);
    expect((await editor.patch(`pages/${id}/slides/${second}`, { beforeId: null })).status()).toBe(409);
    await withPrisma((prisma) => prisma.page.update({ where: { id }, data: { lockedAt: null } }));

    expect((await editor.delete(`pages/${id}/slides/${second}`)).status()).toBe(200);
    expect((await slidesOf(editor, id)).map((s) => s.id)).toEqual([first.id]);
  });

  test("someone not logged in gets nothing of a hidden slide, its images included", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const editor = api(request, await keyFor("editor", "WRITE"));
    const id = await createDeck(editor, `E2E 公開プレゼン ${Date.now()}`);
    const [shown] = await slidesOf(editor, id);
    const hidden = ((await (await editor.post(`pages/${id}/slides`)).json()) as { id: string }).id;

    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await guestContext.newPage();
    try {
      await page.goto(`pages/${id}`);
      const upload = async (name: string) => {
        const res = await page.request.post(`api/files?pageId=${encodeURIComponent(id)}`, {
          headers: { Origin: new URL(page.url()).origin },
          multipart: { file: { name, mimeType: "image/png", buffer: Buffer.from(PNG, "base64") } },
        });
        expect(res.status()).toBe(201);
        return ((await res.json()) as { url: string }).url;
      };
      const shownImage = await upload("shown.png");
      const hiddenImage = await upload("hidden.png");
      const image = (src: string) => ({ add: [{ type: "image", x: 10, y: 10, w: 100, h: 100, src }] });
      expect((await editor.post(`pages/${shown.id}/whiteboard`, image(shownImage))).status()).toBe(200);
      expect((await editor.post(`pages/${hidden}/whiteboard`, image(hiddenImage))).status()).toBe(200);
      expect((await editor.patch(`pages/${id}/slides/${hidden}`, { hidden: true })).status()).toBe(200);
      await withPrisma(async (prisma) => {
        const group = await prisma.group.findUniqueOrThrow({ where: { builtIn: PUBLIC_GROUP }, select: { id: true } });
        await prisma.pageGrant.create({ data: { pageId: id, groupId: group.id, access: "VIEW" } });
      });

      // The shown slide's image is served once the page's file list is saved.
      await expect
        .poll(async () => (await guestContext.request.get(shownImage.slice(1))).status(), { timeout: 40_000 })
        .toBe(200);
      expect((await guestContext.request.get(hiddenImage.slice(1))).status()).toBe(404);
      // Whoever is logged in and can open the presentation still gets it.
      expect((await page.request.get(hiddenImage.slice(1))).status()).toBe(200);

      expect((await guest.goto(`pages/${hidden}`))?.status()).toBe(404);
      await guest.goto(`pages/${id}`);
      await expect(guest.getByTestId("StaticPresentation.status")).toHaveText("1 / 1");
      await expect(guest.getByTestId("Whiteboard.slideFrame")).toBeVisible();
    } finally {
      await context.close();
      await guestContext.close();
    }
  });

  test("moving a slide copies a file only when the mover approves it", async ({ request, browser }) => {
    const editor = api(request, await keyFor("editor", "WRITE"));
    const from = await createDeck(editor, `E2E 移動元 ${Date.now()}`);
    const to = await createDeck(editor, `E2E 移動先 ${Date.now()}`);
    const [slide] = await slidesOf(editor, from);
    const second = ((await (await editor.post(`pages/${from}/slides`)).json()) as { id: string }).id;

    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await page.goto(`pages/${from}`);
      const res = await page.request.post(`api/files?pageId=${encodeURIComponent(from)}`, {
        headers: { Origin: new URL(page.url()).origin },
        multipart: { file: { name: "secret.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") } },
      });
      expect(res.status()).toBe(201);
      const src = ((await res.json()) as { url: string }).url;
      const fileId = src.split("/").pop()!;
      const image = { add: [{ type: "image", x: 10, y: 10, w: 100, h: 100, src }] };
      expect((await editor.post(`pages/${slide.id}/whiteboard`, image)).status()).toBe(200);
      expect((await editor.post(`pages/${second}/whiteboard`, image)).status()).toBe(200);
      const copies = () => withPrisma((prisma) => prisma.fileObject.count({ where: { pageId: to, copiedFromId: fileId } }));
      const srcOf = async (id: string) =>
        ((await (await editor.get(`pages/${id}/whiteboard`)).json()) as { items: { src?: string }[] }).items[0].src;

      // Not asked for: nothing is copied, and the file is reported.
      const plain = await editor.patch(`pages/${from}/slides/${slide.id}`, { presentationId: to });
      expect(plain.status()).toBe(200);
      expect(((await plain.json()) as { pendingFiles: { id: string; name: string }[] }).pendingFiles).toEqual([{ id: fileId, name: "secret.png" }]);
      expect(await copies()).toBe(0);
      expect(await srcOf(slide.id)).toBe(src);

      // Named: copied, and the slide points at the copy.
      const approved = await editor.patch(`pages/${from}/slides/${second}`, { presentationId: to, copyFiles: [fileId] });
      expect(((await approved.json()) as { pendingFiles: unknown[] }).pendingFiles).toEqual([]);
      expect(await copies()).toBe(1);
      expect(await srcOf(second)).not.toBe(src);

      // What was left can be approved afterwards.
      const later = await editor.patch(`pages/${to}/slides/${slide.id}`, { copyFiles: [fileId] });
      expect(later.status()).toBe(200);
      expect(((await later.json()) as { pendingFiles: unknown[] }).pendingFiles).toEqual([]);
      expect(await srcOf(slide.id)).toBe(await srcOf(second));
    } finally {
      await context.close();
    }
  });

  test("masking reaches a moved slide's notes, and a restore doesn't show a hidden slide", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const editor = api(request, await keyFor("editor", "WRITE"));
    const from = await createDeck(editor, `E2E マスク元 ${Date.now()}`);
    const to = await createDeck(editor, `E2E マスク先 ${Date.now()}`);
    const [slide] = await slidesOf(editor, from);
    const secret = `noteSecret${Date.now()}`;
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await page.goto(`pages/${from}?slide=${slide.id}`);
      await page.getByTestId("SlideNotes.textInput").fill(secret);
      await page.getByTestId("SlideNotes.textInput").blur();
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await expect
        .poll(() => withPrisma((prisma) => prisma.slideNote.count({ where: { slideId: slide.id } })))
        .toBe(1);
      await withPrisma((prisma) => captureSnapshot(prisma, from, "AUTO", null));

      // A restore keeps a slide hidden that was shown in the snapshot.
      expect((await editor.patch(`pages/${from}/slides/${slide.id}`, { hidden: true })).status()).toBe(200);
      const snapshotId = await withPrisma(
        async (prisma) => (await prisma.presentationSnapshot.findFirstOrThrow({ where: { pageId: from }, orderBy: { createdAt: "desc" } })).id,
      );
      await page.goto(`pages/${from}/history`);
      await page.locator(`[data-ui="PresentationHistory.snapshotRow"][data-id="${snapshotId}"]`).getByTestId("PresentationHistory.restoreButton").click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await expect(page.getByTestId("PresentationHistory.status")).toBeVisible({ timeout: 30_000 });
      expect((await slidesOf(editor, from)).find((s) => s.id === slide.id)?.hidden).toBe(true);

      // Moved away, its note taken out, and the text masked on the slide.
      expect((await editor.patch(`pages/${from}/slides/${slide.id}`, { presentationId: to })).status()).toBe(200);
      await page.goto(`pages/${to}?slide=${slide.id}`);
      await expect(page.getByTestId("SlideNotes.textInput")).toHaveValue(secret);
      await page.getByTestId("SlideNotes.textInput").fill("");
      await page.getByTestId("SlideNotes.textInput").blur();
      await expect
        .poll(() => withPrisma((prisma) => prisma.slideNote.count({ where: { slideId: slide.id } })))
        .toBe(0);
      await page.goto(`pages/${slide.id}/history`);
      await page.getByTestId("MaskPanel.openButton").click();
      await page.getByTestId("MaskPanel.input").fill(secret);
      await page.getByTestId("MaskPanel.checkButton").click();
      await page.getByTestId("MaskPanel.applyButton").click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await expect(page.getByTestId("MaskPanel.done")).toBeVisible();

      // Not left in the snapshots of the presentation it came from.
      await withPrisma(async (prisma) => {
        const key = await loadDataKey(prisma);
        const rows = await prisma.presentationSnapshot.findMany({ where: { pageId: from } });
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(JSON.stringify(openSnapshot(key, from, row.id, row.sealed))).not.toContain(secret);
      });
    } finally {
      await context.close();
    }
  });
});
