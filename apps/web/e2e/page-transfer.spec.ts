import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { encrypt, loadDataKey } from "shared";
import { ACCOUNTS, HOME_PAGE_ID, type Role, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { editorBody, openPage } from "./helpers";

// Copying pages through MCP and the API (lib/page-transfer/): a one-time link
// (export_page / POST .../export) and its import (import_pages / POST
// .../import), here on this site (another site goes through the same bundle,
// fetched over HTTP). Keys are made in the database as in mcp.spec.ts.

const createdPages: string[] = [];

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function setApi(on: boolean) {
  await withPrisma((prisma) =>
    prisma.instanceConfig.update({
      where: { id: 1 },
      data: { apiEnabled: on, mcpEnabled: on, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] },
    }),
  );
}

async function keyFor(role: Role, scope: "READ" | "WRITE"): Promise<string> {
  return withPrisma(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS[role].email) });
    const key = "kn_" + randomBytes(32).toString("base64url");
    const id = randomUUID();
    const name = encrypt(await loadDataKey(prisma), Buffer.from("E2E copy"), `knowlective:api-key-name:${id}`);
    await prisma.apiKey.create({
      data: { id, userId: user.id, tokenHash: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 11), nameEnc: Uint8Array.from(name), scope },
    });
    return key;
  });
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

async function connect(baseURL: string, key: string) {
  const client = new Client({ name: "e2e", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("api/mcp", baseURL), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }),
  );
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult;
  return { client, call, close: () => client.close() };
}

const data = (result: ToolResult) => JSON.parse(result.content[0].text);

test.describe("Copying pages", () => {
  test.use({ storageState: authFile("editor") });

  test.beforeEach(async () => {
    await setApi(true);
  });

  test.afterEach(async () => {
    await setApi(false);
    await withPrisma(async (prisma) => {
      await prisma.apiKey.deleteMany({});
      await prisma.pageExport.deleteMany({});
      if (createdPages.length > 0) {
        await prisma.page.updateMany({ where: { id: { in: createdPages } }, data: { deletedAt: new Date() } });
      }
    });
    createdPages.length = 0;
  });

  test("copies a page with its child pages and attachments through a one-time link", async ({ page, baseURL }) => {
    const mcp = await connect(baseURL!, await keyFor("editor", "WRITE"));
    try {
      const stamp = Date.now();
      const source = data(await mcp.call("create_page", { parentId: HOME_PAGE_ID, title: `E2E コピー元 ${stamp}` })).id as string;
      createdPages.push(source);
      const upload = await page.request.post(`api/files?pageId=${source}`, {
        multipart: { file: { name: "点.png", mimeType: "image/png", buffer: PNG } },
      });
      expect(upload.status()).toBe(201);
      const fileUrl = ((await upload.json()) as { url: string }).url;
      const child = data(await mcp.call("create_page", { parentId: source, title: "E2E コピー元の子", markdown: "子の本文" })).id as string;
      createdPages.push(child);
      await mcp.call("append_to_page", {
        pageId: source,
        markdown: `## 見出し\n\n本文の段落\n\n- [ ] やること\n\n![点](${fileUrl})\n\n[子へ](/pages/${child})`,
      });

      const link = await mcp.call("export_page", { pageId: source });
      expect(link.isError).toBeFalsy();
      const { url, pages } = data(link);
      expect(pages).toBe(2);
      expect(url).toMatch(/\/api\/v1\/exports\/knx_/);

      const imported = await mcp.call("import_pages", { parentId: HOME_PAGE_ID, url });
      expect(imported.isError, imported.content[0].text).toBeFalsy();
      const result = data(imported);
      createdPages.push(result.id);
      expect(result.pages).toBe(2);
      expect(result.sameSite).toBe(true);
      expect(result.files.copied).toBe(1);

      // The same content, with the copies' own ids.
      const copy = await mcp.call("get_page", { pageId: result.id });
      const original = await mcp.call("get_page", { pageId: source });
      expect(data(copy).title).toBe(`E2E コピー元 ${stamp}`);
      const copied = await withPrisma(async (prisma) => {
        const children = await prisma.page.findMany({ where: { parentId: result.id }, select: { id: true, title: true } });
        const files = await prisma.fileObject.findMany({ where: { pageId: result.id }, select: { id: true, name: true } });
        return { children, files };
      });
      expect(copied.children.map((c) => c.title)).toEqual(["E2E コピー元の子"]);
      createdPages.push(copied.children[0].id);
      expect(copied.files.map((f) => f.name)).toEqual(["点.png"]);
      const sourceFile = fileUrl.split("/").pop()!;
      const expected = original.content[1].text
        .replaceAll(sourceFile, copied.files[0].id)
        .replaceAll(child, copied.children[0].id);
      expect(copy.content[1].text).toBe(expected);

      // In the editor, as it was.
      await openPage(page, result.id);
      await expect(editorBody(page)).toContainText("本文の段落");
      await expect(editorBody(page).locator('[data-content-type="todo"]')).toHaveCount(1);

      // The link worked once.
      const again = await mcp.call("import_pages", { parentId: HOME_PAGE_ID, url });
      expect(again.isError).toBe(true);
      expect(again.content[0].text).toMatch(/used already/);

      // copy_page does both at once.
      const copiedAgain = await mcp.call("copy_page", { pageId: child, parentId: HOME_PAGE_ID });
      expect(copiedAgain.isError).toBeFalsy();
      createdPages.push(data(copiedAgain).id);
      expect(data(await mcp.call("get_page", { pageId: data(copiedAgain).id })).title).toBe("E2E コピー元の子");

      // Kept in the audit log.
      const logged = await withPrisma((prisma) =>
        Promise.all([
          prisma.auditLog.count({ where: { action: "page.export", createdAt: { gte: new Date(stamp) } } }),
          prisma.auditLog.count({ where: { action: "page.import", createdAt: { gte: new Date(stamp) } } }),
        ]),
      );
      expect(logged).toEqual([2, 2]);
    } finally {
      await mcp.close();
    }
  });

  test("copies a presentation with its slides, their order and its settings", async ({ baseURL }) => {
    const mcp = await connect(baseURL!, await keyFor("editor", "WRITE"));
    try {
      const deck = data(await mcp.call("create_page", { parentId: HOME_PAGE_ID, title: `E2E コピーのプレゼン ${Date.now()}`, kind: "PRESENTATION" })).id as string;
      createdPages.push(deck);
      const second = data(await mcp.call("add_slide", { pageId: deck })).id as string;
      await mcp.call("edit_whiteboard", { pageId: second, add: [{ type: "sticky", x: 100, y: 100, w: 200, h: 200, text: "二枚目" }] });
      await withPrisma(async (prisma) => {
        await prisma.presentationSettings.update({ where: { pageId: deck }, data: { numberingEnabled: true, hiddenSlideIds: [second] } });
      });

      const copied = await mcp.call("copy_page", { pageId: deck, parentId: HOME_PAGE_ID });
      expect(copied.isError, copied.content[0].text).toBeFalsy();
      const copy = data(copied).id as string;
      createdPages.push(copy);
      expect(data(copied).pages).toBe(3);

      const slides = data(await mcp.call("list_slides", { pageId: copy })).slides as { id: string; hidden: boolean }[];
      expect(slides).toHaveLength(2);
      expect(slides.map((s) => s.hidden)).toEqual([false, true]);
      const board = await mcp.call("get_page", { pageId: slides[1].id });
      expect(JSON.stringify(board.content)).toContain("二枚目");
      const settings = await withPrisma((prisma) => prisma.presentationSettings.findUniqueOrThrow({ where: { pageId: copy } }));
      expect(settings.numberingEnabled).toBe(true);
      expect(settings.hiddenSlideIds).toEqual([slides[1].id]);

      // A slide goes with its presentation only.
      expect((await mcp.call("export_page", { pageId: second })).isError).toBe(true);
    } finally {
      await mcp.close();
    }
  });

  test("the link gives the pages once, to anyone who has it; importing needs edit access", async ({ request, baseURL }) => {
    const writer = await keyFor("editor", "WRITE");
    const reader = await keyFor("editor", "READ");
    const created = await request.post("api/v1/pages", {
      headers: { Authorization: `Bearer ${writer}` },
      data: { parentId: HOME_PAGE_ID, title: `E2E コピーの API ${Date.now()}`, markdown: "API の本文" },
    });
    expect(created.status()).toBe(201);
    const source = ((await created.json()) as { id: string }).id;
    createdPages.push(source);

    // A read-only key can make a link…
    const made = await request.post(`api/v1/pages/${source}/export`, { headers: { Authorization: `Bearer ${reader}` } });
    expect(made.status()).toBe(201);
    const { url } = (await made.json()) as { url: string };
    // …which needs no key, and works once.
    const path = new URL(url).pathname.replace(/^.*?(api\/v1\/exports\/)/, "$1");
    const first = await request.get(path);
    expect(first.status()).toBe(200);
    const bundle = await first.json();
    expect(bundle.format).toBe("knowlective-pages");
    expect(bundle.pages[0].title).toMatch(/E2E コピーの API/);
    // No addresses in it, only salted hashes.
    expect(JSON.stringify(bundle)).not.toContain("@example.com");
    expect((await request.get(path)).status()).toBe(404);
    expect((await request.get("api/v1/exports/knx_" + "a".repeat(43))).status()).toBe(404);

    // A read-only key can't import, and a viewer can't import under a page they only view.
    const second = await request.post(`api/v1/pages/${source}/export`, { headers: { Authorization: `Bearer ${writer}` } });
    const secondUrl = ((await second.json()) as { url: string }).url;
    const readOnly = await request.post(`api/v1/pages/${HOME_PAGE_ID}/import`, { headers: { Authorization: `Bearer ${reader}` }, data: { url: secondUrl } });
    expect(readOnly.status()).toBe(403);
    const viewer = await request.post(`api/v1/pages/${HOME_PAGE_ID}/import`, {
      headers: { Authorization: `Bearer ${await keyFor("viewer", "WRITE")}` },
      data: { url: secondUrl },
    });
    expect(viewer.status()).toBe(404);
    // Not a copy link at all.
    const bad = await request.post(`api/v1/pages/${HOME_PAGE_ID}/import`, { headers: { Authorization: `Bearer ${writer}` }, data: { url: "https://example.com/x" } });
    expect((await bad.json()).error.code).toBe("bad_link");

    // The editor can.
    const ok = await request.post(`api/v1/pages/${HOME_PAGE_ID}/import`, { headers: { Authorization: `Bearer ${writer}` }, data: { url: secondUrl } });
    expect(ok.status()).toBe(201);
    createdPages.push(((await ok.json()) as { id: string }).id);

    // An outsider's key can't make a link to a page they can't see.
    const outsider = await request.post(`api/v1/pages/${source}/export`, { headers: { Authorization: `Bearer ${await keyFor("outsider", "READ")}` } });
    expect(outsider.status()).toBe(404);
  });
});
